import { CloudFormationResource } from 'serverless/aws';
import { AwsConfig } from '../../../../types/aws-config-interface';

export interface SqsTargetHandlerParams {
  targetResource: CloudFormationResource;
  awsConfig: AwsConfig;
  roleResourceTarget: {
    SqsParameters?: {
      MessageGroupId?: string;
    };
  };
}

export function sqsTargetHandler({
  targetResource,
  awsConfig,
  roleResourceTarget,
}: SqsTargetHandlerParams) {
  const sqsQueueName = targetResource.Properties['QueueName'];
  const arn = `arn:aws:sqs:${awsConfig.region}:${awsConfig.accountId}:${sqsQueueName}`;

  return {
    arn,
    sqsParameters: roleResourceTarget.SqsParameters,
  };
}
