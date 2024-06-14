import { App, Stack, StackProps } from "aws-cdk-lib";
import { Cognito, Vpc, SecurityGroups, Waf, EcsService } from "./constructs";
import type { IStreamlitEcsFargateCognito } from "./constructs";

export class StreamlitEcsFargateCognitoStack extends Stack {
  constructor(scope: App, id: string, params: IStreamlitEcsFargateCognito, props?: StackProps) {
    super(scope, id, props);

    const { environment } = params;

    // cognito
    const { userPool, userPoolClient, userPoolDomain } = new Cognito(this, "Cognito", params.cognito);

    // vpc + security group
    const { vpc } = new Vpc(this, "Vpc");
    const { albSecurityGroup, ecsSecurityGroup } = new SecurityGroups(this, "SecurityGroup", { vpc, environment });

    // waf
    const { webAcl } = new Waf(this, "Waf");

    // alb + ecs
    new EcsService(this, "EcsService", {
      environment,
      vpc,
      albSecurityGroup,
      ecsSecurityGroup,
      webAcl,
      cognito: {
        userPool,
        userPoolClient,
        userPoolDomain,
      },
      ...params.ecsService,
    });
  }
}
