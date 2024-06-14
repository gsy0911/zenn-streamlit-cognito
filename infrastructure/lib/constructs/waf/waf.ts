import { Stack, aws_iam, aws_wafv2, aws_s3, aws_lambda, aws_events, aws_events_targets, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";

import { PythonFunction } from "@aws-cdk/aws-lambda-python-alpha";
import { prefix } from "../params";
import * as path from "path";

/**
 * Wafを作成するStack
 * この場合の料金は
 * Web ACL: 5 [USD/Month] * 2(保護するリソースの数, 検証と本番を想定) = 10 [USD/Month]
 * Rules: 1 [USD/Month] * 5
 *
 * AWS MarketPlace(https://aws.amazon.com/marketplace)から購入するルールを利用する場合は、別途利用料金がかかる。
 * ただ、AWSがデフォルトで提供するマネージドルールは追加料金はかからない。
 *
 * そのため、月額 15[USD/Month]で利用可能。
 * （実際の課金額は時間で案分される）。
 *
 * Web ACL Capacity Unit (WCU) という項目があるが、課金額には関係ない。
 * 下のWCUは1400となっている。
 *
 * WAFとFirehoseは接続されているが、
 * CDK上ではその設定項目がないため手動で行っている。
 *
 * AWSが提供しているマネージドルール
 * @see https://docs.aws.amazon.com/ja_jp/waf/latest/developerguide/aws-managed-rule-groups-list.html
 *
 * waf(v1)のテンプレートCloudFormation
 * @see https://aws.amazon.com/jp/about-aws/whats-new/2017/07/use-aws-waf-to-mitigate-owasps-top-10-web-application-vulnerabilities/
 *
 * AWS Security Automation
 * @see https://aws.amazon.com/jp/solutions/implementations/aws-waf-security-automations/
 * @see https://docs.aws.amazon.com/ja_jp/solutions/latest/aws-waf3-security-automations/architecture.html
 */
export class Waf extends Construct {
  public readonly webAcl: aws_wafv2.CfnWebACL;
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const account = Stack.of(this).account;
    /** bucket to store log from Firehose */
    const S3ForWafLogName = `aws-waf-logs-${account}-${prefix}`;

    // ここに記載されているIPや観測された外国のIPアドレスのうち、不審なアクセスをしているもの
    // https://oubonarumamay.hatenablog.com/entry/2019/05/22/103224
    // https://docs.aws.amazon.com/ja_jp/AWSCloudFormation/latest/UserGuide/aws-resource-wafv2-ipset.html
    // Kinesisなどを利用してIPリストの更新を行っているので、ここにある内容は変わっていることがある。
    const blockIpList = [
      "104.248.146.28/32",
      "52.77.232.164/32",
      "159.203.19.100/32",
      "167.71.13.196/32",
      "185.165.190.34/32",
    ];
    const ipSetsName = `blocked-ip-lists`;
    const ipSets = new aws_wafv2.CfnIPSet(this, "IPSets", {
      addresses: blockIpList,
      ipAddressVersion: "IPV4",
      scope: "REGIONAL",
      description: "blocked IP lists",
      name: ipSetsName,
    });

    // WebACLを作成
    const webAcl = new aws_wafv2.CfnWebACL(this, "WebWafAcl", {
      defaultAction: { allow: {} },
      name: `${prefix}-waf-web-acl`,
      rules: [
        {
          priority: 1,
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "AWS-ManagedRulesCommonRuleSet",
          },
          name: "AWSManagedRulesCommonRuleSet",
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesCommonRuleSet",
            },
          },
        },
        {
          priority: 2,
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "AWS-ManagedRulesKnownBadInputsRuleSet",
          },
          name: "AWSManagedRulesKnownBadInputsRuleSet",
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesKnownBadInputsRuleSet",
            },
          },
        },
        {
          priority: 3,
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "AWS-ManagedRulesAdminProtectionRuleSet",
          },
          name: "AWSManagedRulesAdminProtectionRuleSet",
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesAdminProtectionRuleSet",
            },
          },
        },
        {
          priority: 4,
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "AWS-AWSManagedRulesSQLiRuleSet",
          },
          name: "AWSAWSManagedRulesSQLiRuleSet",
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesSQLiRuleSet",
            },
          },
        },
        {
          priority: 5,
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "AWS-ManagedRulesLinuxRuleSet",
          },
          name: "AWSManagedRulesLinuxRuleSet",
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesLinuxRuleSet",
            },
          },
        },
        /** 以下はカスタムルール */
        {
          priority: 6,
          name: "BlockIpLists",
          action: { block: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "BlockIpLists",
          },
          statement: {
            ipSetReferenceStatement: {
              arn: ipSets.attrArn,
            },
          },
        },
      ],
      scope: "REGIONAL",
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `${prefix}-waf-web-acl`,
        sampledRequestsEnabled: true,
      },
    });

    // S3 Config (Restricted Public Access)
    const public_access_block_config: aws_s3.CfnBucket.PublicAccessBlockConfigurationProperty = {
      blockPublicAcls: true,
      blockPublicPolicy: true,
      ignorePublicAcls: true,
      restrictPublicBuckets: true,
    };
    // S3
    const S3ForWafLog = new aws_s3.CfnBucket(this, "S3BucketForWafLogConfig", {
      bucketName: S3ForWafLogName,
      publicAccessBlockConfiguration: public_access_block_config,
    });
    new aws_wafv2.CfnLoggingConfiguration(this, "CfnLoggingConfiguration", {
      logDestinationConfigs: [S3ForWafLog.attrArn],
      resourceArn: webAcl.attrArn,
    });

    /** Lambdaに付与するロール */
    const wafv2IpSetUpdateRole = new aws_iam.Role(this, "PpUpdate", {
      roleName: `${prefix}-waf-role`,
      assumedBy: new aws_iam.ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        policies: new aws_iam.PolicyDocument({
          statements: [
            new aws_iam.PolicyStatement({
              effect: aws_iam.Effect.ALLOW,
              resources: ["*"],
              actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
            }),
            new aws_iam.PolicyStatement({
              effect: aws_iam.Effect.ALLOW,
              resources: ["*"],
              actions: ["wafv2:ListIPSets", "wafv2:GetIPSet", "wafv2:UpdateIPSet"],
            }),
            new aws_iam.PolicyStatement({
              effect: aws_iam.Effect.ALLOW,
              resources: [`arn:aws:s3:::${S3ForWafLog.bucketName}`, `arn:aws:s3:::${S3ForWafLog.bucketName}/*`],
              actions: ["s3:Get*", "s3:List*"],
            }),
          ],
        }),
      },
    });

    /** 有害なIPリストを更新するLambda */
    const lambdaWafv2IpSetUpdate = new PythonFunction(this, "LambdaWafv2IpSetUpdate", {
      functionName: `${prefix}_wafv2_ip_set_update`,
      entry: path.resolve("lib", "constructs", "waf", "lambda"),
      index: "update_popular_ip_list.py",
      handler: "handler",
      runtime: aws_lambda.Runtime.PYTHON_3_12,
      timeout: Duration.seconds(60),
      memorySize: 256,
      role: wafv2IpSetUpdateRole,
      environment: {
        IP_SETS_ARN: ipSets.attrArn,
        IP_SETS_NAME: ipSets.name || ipSetsName,
      },
    });

    /** 1日に1回起動する（cronの設定より明確なのと、時間は特に関係ないため） */
    new aws_events.Rule(this, "DailySchedule", {
      schedule: aws_events.Schedule.rate(Duration.hours(24)),
      targets: [new aws_events_targets.LambdaFunction(lambdaWafv2IpSetUpdate)],
    });

    /** 脆弱性をつくアクセスをするIPをブロックするLambda */
    const lambdaWafv2IpSetUpdateForVulnerability = new PythonFunction(this, "LambdaWafv2IpSetUpdateForVulnerability", {
      functionName: `${prefix}_wafv2_ip_set_update_for_vulnerability`,
      entry: path.resolve("lib", "constructs", "waf", "lambda"),
      index: "block_vulnerability_candidate_ip.py",
      handler: "handler",
      runtime: aws_lambda.Runtime.PYTHON_3_12,
      timeout: Duration.seconds(60),
      memorySize: 256,
      role: wafv2IpSetUpdateRole,
      environment: {
        IP_SETS_ARN: ipSets.attrArn,
        IP_SETS_NAME: ipSets.name || ipSetsName,
      },
    });

    /** 2時間に1回起動する */
    new aws_events.Rule(this, "blockVulnerabilityCandidateSchedule", {
      schedule: aws_events.Schedule.rate(Duration.hours(2)),
      targets: [new aws_events_targets.LambdaFunction(lambdaWafv2IpSetUpdateForVulnerability)],
    });

    this.webAcl = webAcl;
  }
}
