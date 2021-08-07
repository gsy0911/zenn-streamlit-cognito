import * as cdk from "@aws-cdk/core";
import { StreamlitEcsFargateCognitoStack } from './StreamlitEcsFargateStack';
import { params } from './params'

const app = new cdk.App();
new StreamlitEcsFargateCognitoStack(app, "streamlit-cognito", params, {env: params.env});
app.synth();
