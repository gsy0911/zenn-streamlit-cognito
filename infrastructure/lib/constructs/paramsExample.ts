import type { ICognitoConstants } from "./cognito";
import type { IEcsServiceConstants } from "./ecsService";
import { Environment } from "aws-cdk-lib";

export const envApNortheast1: Environment = {
  account: "111122223333",
  region: "ap-northeast-1",
};

// AWS上に展開している環境の識別子
export type environment = "dev" | "stg" | "prod";
// サービスの名前など
export const prefix = "your-streamlit";

export interface IStreamlitEcsFargateCognito {
  environment: environment;
  cognito: ICognitoConstants;
  ecsService: IEcsServiceConstants;
}

export const paramsStreamlitEcsFargateCognito: IStreamlitEcsFargateCognito = {
  environment: "dev",
  ecsService: {
    s3BucketName: "",
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
    domainPrefix: "your-prefix",
    privateClient: {
      callbackUrls: ["https://streamlit.your.domain.com/oauth2/idpresponse"],
      logoutUrls: ["https://streamlit.your.domain.com/signout"],
    },
  },
};
