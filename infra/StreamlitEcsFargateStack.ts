import * as cdk from '@aws-cdk/core';
import * as cognito from '@aws-cdk/aws-cognito';
import * as elb from "@aws-cdk/aws-elasticloadbalancingv2";
import * as elbActions from '@aws-cdk/aws-elasticloadbalancingv2-actions';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as iam from "@aws-cdk/aws-iam";
import * as route53 from '@aws-cdk/aws-route53';
import * as target from '@aws-cdk/aws-route53-targets';


export interface IStreamlitEcsFargateCognito {
	vpcId: string
	env: {
		account: string
		region: string
	},
	alb: {
		route53DomainName: string
		certificate: string
	}
	cognito: {
		callbackUrls: string[]
		logoutUrls: string[]
		domainPrefix: string
	}
}


export class StreamlitEcsFargateCognitoStack extends cdk.Stack {
	constructor(scope: cdk.App, id: string, params: IStreamlitEcsFargateCognito, props?: cdk.StackProps) {
		super(scope, id, props);

		const userPool = new cognito.UserPool(this, "userPool", {
			userPoolName: "streamlit-user-pool-test",
			// self signUp disabled
			selfSignUpEnabled: false,
			userVerification: {
				emailSubject: "Verify email message",
				emailBody: "Thanks for signing up! Your verification code is {####}",
				emailStyle: cognito.VerificationEmailStyle.CODE,
				smsMessage: "Thanks for signing up! Your verification code is {####}"
			},
			// sign in
			signInAliases: {
				username: true,
				email: true
			},
			// user attributes
			standardAttributes: {
				nickname: {
					required: true,
					// `mutable` means changeable
					mutable: true
				}
			},
			// role, specify if you want
			mfa: cognito.Mfa.OPTIONAL,
			mfaSecondFactor: {
				sms: true,
				otp: true
			},
			passwordPolicy: {
				minLength: 8,
				requireLowercase: true,
				requireUppercase: true,
				requireDigits: true,
				requireSymbols: true,
				tempPasswordValidity: cdk.Duration.days(3)
			},
			accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			// emails, by default `no-reply@verificationemail.com` used
		})

		// only available domain
		const userPoolDomain = userPool.addDomain("cognito-domain", {
			cognitoDomain: {
				domainPrefix: params.cognito.domainPrefix
			}
		})

		// App Clients
		const app1 = userPool.addClient("appClient1", {
			userPoolClientName: "appClient1",
			generateSecret: true,
			authFlows: {
				userPassword: true,
				userSrp: true
			},
			oAuth: {
				callbackUrls: params.cognito.callbackUrls,
				logoutUrls: params.cognito.logoutUrls
			}
		})

		const vpc = ec2.Vpc.fromLookup(this, "existing-vpc", {
			vpcId: params.vpcId
		})
		const cluster = new ecs.Cluster(this, 'FargateCluster', {
			vpc: vpc,
			clusterName: "streamlit-cluster",
		});

		// create a task definition with CloudWatch Logs
		const logging = new ecs.AwsLogDriver({
			streamPrefix: "myapp",
		})

		const taskRole = new iam.Role(this, 'taskRole', {
			assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
			managedPolicies: [
				iam.ManagedPolicy.fromManagedPolicyArn(this, "ecsFullAccess", "arn:aws:iam::aws:policy/AmazonECS_FullAccess")
			]
		})
		const taskDef = new ecs.FargateTaskDefinition(this, "MyTaskDefinition", {
			memoryLimitMiB: 512,
			cpu: 256,
			taskRole: taskRole
		})

		taskDef.addContainer("StreamlitContainer", {
			image: ecs.ContainerImage.fromAsset("../streamlit"),
			portMappings: [
				{
					containerPort: 80,
					hostPort: 80
				}
			],
			command: ["streamlit", "run", "app.py"],
			logging
		})

		const ecsServiceSecurityGroup = new ec2.SecurityGroup(this, "ecs-service-sg", {
			vpc,
			securityGroupName: "streamlit-service-sg",
			description: "security group to allow IdP",
		})

		const service = new ecs.FargateService(this, "StreamlitService", {
			cluster: cluster,
			taskDefinition: taskDef,
			deploymentController: {
				type: ecs.DeploymentControllerType.CODE_DEPLOY
			},
			healthCheckGracePeriod: cdk.Duration.seconds(5),
			assignPublicIp: true,
			securityGroups: [ecsServiceSecurityGroup],
		})

		// https://<alb-domain>/oauth2/idpresponse
		// requires allowing HTTPS egress-rule
		const albSecurityGroup = new ec2.SecurityGroup(this, "alb-sg", {
			vpc,
			securityGroupName: "streamlit-alb-sg",
			description: "security group to allow IdP",
			allowAllOutbound: false
		})
		albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "allow HTTP")
		albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8080), "allow alt HTTP")
		albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "allow HTTPS")
		albSecurityGroup.addEgressRule(ecsServiceSecurityGroup, ec2.Port.tcp(80), "allow HTTP")
		albSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "allow HTTPS")
		ecsServiceSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(80), "allow from alb-HTTP")

		const alb = new elb.ApplicationLoadBalancer(this, "ApplicationLoadBalancer", {
			loadBalancerName: "StreamlitALB",
			vpc: vpc,
			idleTimeout: cdk.Duration.seconds(30),
			// scheme: true to access from external internet
			internetFacing: true,
			securityGroup: albSecurityGroup
		})

		const listenerHttp1 = alb.addListener("listener-https", {
			protocol: elb.ApplicationProtocol.HTTPS,
			certificates: [elb.ListenerCertificate.fromArn(params.alb.certificate)]
		})

		const targetGroupBlue = listenerHttp1.addTargets("http-blue-target", {
			targetGroupName: "http-blue-target",
			protocol: elb.ApplicationProtocol.HTTP,
			deregistrationDelay: cdk.Duration.seconds(30),
			targets: [service],
			healthCheck: {
				healthyThresholdCount: 2,
				interval: cdk.Duration.seconds(10)
			},
		})
		listenerHttp1.addAction("cognito-auth-elb-1", {
			action: new elbActions.AuthenticateCognitoAction({
				userPool: userPool,
				userPoolClient: app1,
				userPoolDomain: userPoolDomain,
				scope: "openid",
				onUnauthenticatedRequest: elb.UnauthenticatedAction.AUTHENTICATE,
				next: elb.ListenerAction.forward([targetGroupBlue])
			}),
			conditions: [elb.ListenerCondition.pathPatterns(["*"])],
			priority: 1
		})
		// redirect to https
		alb.addListener("listenerRedirect", {
			protocol: elb.ApplicationProtocol.HTTP,
			defaultAction: elb.ListenerAction.redirect({
				port: "443",
				protocol: elb.ApplicationProtocol.HTTPS,
			})
		})

		// Route 53 for alb
		const albHostedZone = route53.HostedZone.fromLookup(this, "alb-hosted-zone", {
			domainName: params.alb.route53DomainName
		})
		new route53.ARecord(this, "alb-a-record", {
			zone: albHostedZone,
			target: route53.RecordTarget.fromAlias(new target.LoadBalancerTarget(alb))
		})
	}
}
