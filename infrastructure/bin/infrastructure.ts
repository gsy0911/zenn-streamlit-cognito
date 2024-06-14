import * as cdk from "aws-cdk-lib";
import * as lib from "../lib";

const app = new cdk.App();
new lib.StreamlitEcsFargateCognitoStack(app, "streamlit-cognito", lib.paramsStreamlitEcsFargateCognito, {
  env: lib.envApNortheast1,
});
app.synth();
