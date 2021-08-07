import { IStreamlitEcsFargateCognito } from './StreamlitEcsFargateStack';


export const params: IStreamlitEcsFargateCognito = {
	vpcId: "vpc-xxxxxxxx",
	env: {
		account: "123456789012",
		region: "ap-northeast-1"
	},
	alb: {
		certificate: "arn:aws:acm:ap-northeast-1:123456789012:certificate/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
		route53DomainName: "your.domain.com"
	},
	cognito: {
		domainPrefix: "as-you-like",
		callbackUrls: ["https://your.domain.com/oauth2/idpresponse"],
		logoutUrls: ["https://your.domain.com"]
	},
}
