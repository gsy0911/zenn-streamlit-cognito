import { Duration, RemovalPolicy, aws_cognito } from "aws-cdk-lib";
import { Construct } from "constructs";
import { type environment, prefix } from "./params";

interface privateClient {
  callbackUrls: `https://${string}/oauth2/idpresponse`[];
  logoutUrls: `https://${string}/signout`[];
}

export interface ICognito {
  environment: environment;
  domainPrefix: string;
  privateClient: privateClient;
}

export type ICognitoConstants = Omit<ICognito, "environment">;

export class Cognito extends Construct {
  public readonly userPool: aws_cognito.IUserPool;
  public readonly userPoolClient: aws_cognito.IUserPoolClient;
  public readonly userPoolDomain: aws_cognito.IUserPoolDomain;
  constructor(scope: Construct, id: string, params: ICognito) {
    super(scope, id);
    const { environment, domainPrefix, privateClient } = params;

    const userPool = new aws_cognito.UserPool(this, "UserPool", {
      userPoolName: `${prefix}-user-pool-${environment}`,
      // self signUp disabled
      selfSignUpEnabled: false,
      userVerification: {
        emailSubject: "Verify email message",
        emailBody: "Thanks for signing up! Your verification code is {####}",
        emailStyle: aws_cognito.VerificationEmailStyle.CODE,
        smsMessage: "Thanks for signing up! Your verification code is {####}",
      },
      // sign in
      signInAliases: {
        username: true,
        email: true,
      },
      // user attributes
      standardAttributes: {
        nickname: {
          required: true,
          // `mutable` means changeable
          mutable: true,
        },
      },
      // role, specify if you want
      mfa: aws_cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: true,
        otp: true,
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(3),
      },
      accountRecovery: aws_cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.DESTROY,
      // emails, by default `no-reply@verificationemail.com` used
    });

    // only available domain
    const userPoolDomain = userPool.addDomain("CognitoDomain", {
      cognitoDomain: {
        domainPrefix,
      },
    });

    // App Clients
    const userPoolClient = userPool.addClient("PrivateClient`", {
      userPoolClientName: "private-client",
      generateSecret: true,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: {
        callbackUrls: privateClient.callbackUrls,
        logoutUrls: privateClient.logoutUrls,
      },
    });

    this.userPool = userPool;
    this.userPoolClient = userPoolClient;
    this.userPoolDomain = userPoolDomain;
  }
}
