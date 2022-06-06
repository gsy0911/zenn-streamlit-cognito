import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as lib from '../lib';

const app = new cdk.App();
new lib.StreamlitEcsFargateCognitoStack(app, "streamlit-cognito", lib.params, {env: lib.params.env});
app.synth();
