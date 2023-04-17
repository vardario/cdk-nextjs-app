import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "path";

import { NextJsApp } from "../../../lib";

export class FrontendStack extends cdk.Stack {
  public nextJsApp: NextJsApp;
  public readonly appUrl: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.nextJsApp = new NextJsApp(this, "FrontendNextJsApp", {
      nextJsPath: path.resolve(__dirname, "../../nextjs-app"),
    });

    this.appUrl = new cdk.CfnOutput(this, "FrontendAppUrl", {
      value: this.nextJsApp.appUrl,
    });
  }
}
