import type { ICognito } from "./cognito";
import type { IEcsServiceConstants } from "./ecsService";
import { Environment } from "aws-cdk-lib";

export const envApNortheast1: Environment = {
  account: "111122223333",
  region: "ap-northeast-1",
};

// AWS上に展開している環境の識別子
export type environment = "dev" | "stg" | "prod";
// サービスの名前など
export const prefix = "your-service";

export interface IStreamlitEcsFargateCognito {
  environment: environment;
  cognito: ICognito;
  ecsService: IEcsServiceConstants;
}

export const paramsStreamlitEcsFargateCognito: IStreamlitEcsFargateCognito = {
  environment: "dev",
  ecsService: {
    ecsRoles: {
      s3BucketName: "",
      userPoolName: "ap-northeast-1_${string}",
    },
    ecsService: {
      taskCpu: 1024,
      taskMemoryLimit: 2048,
      allowEcsExec: true,
      healthcheckPath: "/",
    },
    alb: {
      route53DomainName: "your.domain.com",
      route53RecordName: "streamlit.your.domain.com",
    },
  },
  cognito: {
    environment: "dev",
    domainPrefix: "your-dev",
    privateClient: {
      callbackUrls: ["https://streamlit.your.domain.com/oauth2/idpresponse"],
      logoutUrls: ["https://streamlit.your.domain.com/signout"],
    },
  },
};
