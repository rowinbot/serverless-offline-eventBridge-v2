import { CloudFormationResource } from 'serverless/aws';
import { AwsConfig } from '../../../../types/aws-config-interface';

export interface LogsTargetHandlerParams {
  targetResource: CloudFormationResource;
  awsConfig: AwsConfig;
}

export function logsTargetHandler({
  targetResource,
  awsConfig,
}: LogsTargetHandlerParams) {
  const logGroupName = targetResource.Properties['LogGroupName'];
  // CloudWatch Logs ARN format: arn:aws:logs:region:account-id:log-group:log-group-name:*
  const arn = `arn:aws:logs:${awsConfig.region}:${awsConfig.accountId}:log-group:${logGroupName}:*`;

  return { arn };
}
