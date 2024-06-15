import {
  aws_iam,
  aws_ec2,
  aws_ecs,
  Duration,
  aws_elasticloadbalancingv2,
  aws_certificatemanager,
  aws_elasticloadbalancingv2_actions,
  aws_route53,
  aws_route53_targets,
  aws_cognito,
  aws_wafv2,
  Stack,
} from "aws-cdk-lib";
import { Construct } from "constructs";

import { environment, prefix } from "./params";

export interface IEcsRoles {
  /** サービス名の後ろに付与する場合、`-`で終わるとエラーが起きるため */
  environment: environment;
  s3BucketName: string;
  // Idは次の${string}の部分：`ap-northeast-1_${string}`
  userPoolId: string;
}

export class EcsRoles extends Construct {
  public readonly taskRole: aws_iam.IRole;
  public readonly executionRole: aws_iam.IRole;

  constructor(scope: Construct, id: string, params: IEcsRoles) {
    super(scope, id);
    const { environment } = params;
    const account = Stack.of(this).account;
    const region = Stack.of(this).region;
    const userPoolName = `${region}_${params.userPoolId}`;

    /** タスクを作成する際に必要な権限 */
    this.executionRole = new aws_iam.Role(this, "ExecutionRole", {
      roleName: `${prefix}-ecs-execution-${environment}`,
      assumedBy: new aws_iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        aws_iam.ManagedPolicy.fromManagedPolicyArn(
          this,
          "executeCloudWatchFullAccess",
          "arn:aws:iam::aws:policy/AWSOpsWorksCloudWatchLogs",
        ),
        aws_iam.ManagedPolicy.fromManagedPolicyArn(
          this,
          "executeEcrReadAccess",
          "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
        ),
      ],
    });

    /** 実際のFargateインスタンス上にて必要な実行権限 */
    this.taskRole = new aws_iam.Role(this, "TaskRole", {
      roleName: `${prefix}-ecs-task-${environment}`,
      assumedBy: new aws_iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        aws_iam.ManagedPolicy.fromManagedPolicyArn(
          this,
          "taskCloudWatchFullAccess",
          "arn:aws:iam::aws:policy/CloudWatchFullAccessV2",
        ),
        /** Add managed policy to use SSM */
        aws_iam.ManagedPolicy.fromManagedPolicyArn(
          this,
          "taskAmazonEC2RoleforSSM",
          "arn:aws:iam::aws:policy/service-role/AmazonEC2RoleforSSM",
        ),
      ],
      inlinePolicies: {
        accessS3: new aws_iam.PolicyDocument({
          statements: [
            new aws_iam.PolicyStatement({
              effect: aws_iam.Effect.ALLOW,
              resources: [`arn:aws:s3:::${params.s3BucketName}/*`, `arn:aws:s3:::${params.s3BucketName}`],
              actions: ["s3:*"],
            }),
          ],
        }),
        accessCognito: new aws_iam.PolicyDocument({
          statements: [
            new aws_iam.PolicyStatement({
              effect: aws_iam.Effect.ALLOW,
              resources: [`arn:aws:cognito-idp:ap-northeast-1:${account}:userpool/${userPoolName}`],
              actions: ["cognito-idp:*"],
            }),
          ],
        }),
      },
    });
  }
}

export interface IEcsService extends Omit<IEcsRoles, "userPoolId"> {
  vpc: aws_ec2.IVpc;
  albSecurityGroup: aws_ec2.ISecurityGroup;
  ecsSecurityGroup: aws_ec2.ISecurityGroup;
  webAcl: aws_wafv2.CfnWebACL;
  cognito: {
    userPool: aws_cognito.IUserPool;
    userPoolClient: aws_cognito.IUserPoolClient;
    userPoolDomain: aws_cognito.IUserPoolDomain;
  };
  ecsService: {
    taskCpu: 1024 | 2048;
    taskMemoryLimit: 2048 | 8192;
    allowEcsExec: boolean;
    healthcheckPath: "/";
  };
  alb: {
    route53DomainName: string;
    route53RecordName: string;
  };
}

export type IEcsServiceConstants = Omit<
  IEcsService,
  "environment" | "vpc" | "albSecurityGroup" | "ecsSecurityGroup" | "webAcl" | "cognito"
>;

export class EcsService extends Construct {
  constructor(scope: Construct, id: string, params: IEcsService) {
    super(scope, id);

    const { environment, vpc, albSecurityGroup, ecsSecurityGroup } = params;

    const cluster = new aws_ecs.Cluster(this, "FargateCluster", {
      vpc: vpc,
      clusterName: `${prefix}-cluster-${environment}`,
    });

    // create a task definition with CloudWatch Logs
    const logging = new aws_ecs.AwsLogDriver({
      streamPrefix: `${prefix}-${environment}`,
    });

    const { taskRole, executionRole } = new EcsRoles(this, "EcsRoles", {
      environment,
      s3BucketName: params.s3BucketName,
      userPoolId: params.cognito.userPool.userPoolId,
    });

    const taskDef = new aws_ecs.FargateTaskDefinition(this, "TaskDefinition", {
      memoryLimitMiB: params.ecsService.taskMemoryLimit,
      cpu: params.ecsService.taskCpu,
      taskRole,
      executionRole,
    });

    taskDef.addContainer("StreamlitContainer", {
      image: aws_ecs.ContainerImage.fromAsset("../streamlit"),
      portMappings: [
        {
          containerPort: 80,
          hostPort: 80,
        },
      ],
      command: ["streamlit", "run", "app.py"],
      logging,
    });

    const service = new aws_ecs.FargateService(this, "StreamlitService", {
      cluster: cluster,
      taskDefinition: taskDef,
      deploymentController: {
        type: aws_ecs.DeploymentControllerType.CODE_DEPLOY,
      },
      healthCheckGracePeriod: Duration.seconds(5),
      assignPublicIp: false,
      securityGroups: [ecsSecurityGroup],
      enableExecuteCommand: params.ecsService.allowEcsExec,
    });

    // https://<alb-domain>/oauth2/idpresponse
    const alb = new aws_elasticloadbalancingv2.ApplicationLoadBalancer(this, "ApplicationLoadBalancer", {
      loadBalancerName: "StreamlitALB",
      vpc: vpc,
      idleTimeout: Duration.seconds(30),
      // scheme: true to access from external internet
      internetFacing: true,
      securityGroup: albSecurityGroup,
    });

    const albHostedZone = aws_route53.HostedZone.fromLookup(this, "AlbHostedZone", {
      domainName: params.alb.route53DomainName,
    });

    const certificate = new aws_certificatemanager.Certificate(this, "Certificate", {
      domainName: params.alb.route53RecordName,
      validation: aws_certificatemanager.CertificateValidation.fromDns(albHostedZone),
    });
    const listenerHttp1 = alb.addListener("listener-https", {
      protocol: aws_elasticloadbalancingv2.ApplicationProtocol.HTTPS,
      certificates: [certificate],
    });

    const targetGroupBlue = listenerHttp1.addTargets("HttpBlueTarget", {
      targetGroupName: "http-blue-target",
      protocol: aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
      deregistrationDelay: Duration.seconds(30),
      targets: [service],
      healthCheck: {
        healthyThresholdCount: 2,
        interval: Duration.seconds(10),
        path: params.ecsService.healthcheckPath,
      },
    });
    listenerHttp1.addAction("CognitoAuthAlb1", {
      action: new aws_elasticloadbalancingv2_actions.AuthenticateCognitoAction({
        userPool: params.cognito.userPool,
        userPoolClient: params.cognito.userPoolClient,
        userPoolDomain: params.cognito.userPoolDomain,
        scope: "openid",
        onUnauthenticatedRequest: aws_elasticloadbalancingv2.UnauthenticatedAction.AUTHENTICATE,
        next: aws_elasticloadbalancingv2.ListenerAction.forward([targetGroupBlue]),
      }),
      conditions: [aws_elasticloadbalancingv2.ListenerCondition.pathPatterns(["*"])],
      priority: 1,
    });
    // redirect to https
    alb.addListener("ListenerRedirect", {
      protocol: aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
      defaultAction: aws_elasticloadbalancingv2.ListenerAction.redirect({
        port: "443",
        protocol: aws_elasticloadbalancingv2.ApplicationProtocol.HTTPS,
      }),
    });

    // Route 53 for alb
    new aws_route53.ARecord(this, "AlbARecord", {
      zone: albHostedZone,
      target: aws_route53.RecordTarget.fromAlias(new aws_route53_targets.LoadBalancerTarget(alb)),
    });

    /** ALBにWAFの付与。このWAFは`WafStack`にて作成されたもの。変更を加えた場合はここにも修正を加える */
    new aws_wafv2.CfnWebACLAssociation(this, "WebAclAssociation", {
      resourceArn: alb.loadBalancerArn,
      webAclArn: params.webAcl.attrArn,
    });
  }
}
