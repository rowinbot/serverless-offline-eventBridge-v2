import {
  EventBridgeClient,
  EventBus,
  Rule,
  Target,
} from '@aws-sdk/client-eventbridge';
import {
  CloudFormationResource,
  CloudFormationResources,
} from 'serverless/aws';
import {
  ServerlessResourceTypes,
  filterResources,
} from '../../../utils/serverless';
import { Config } from '../../../config/interfaces/config-interface';
import {
  RoleResourceTarget,
  createRuleTargets,
  listRuleTargets,
} from '../utils';
import { snsTargetHandler } from './target-handlers/sns-target-handler';
import { sqsTargetHandler } from './target-handlers/sqs-target-handler';

export interface CreateTargetsParams {
  resources: CloudFormationResources;
  config: Config;
  eventBridgeClient: EventBridgeClient;
  rule: Rule;
  bus: EventBus;
  logDebug: (message: string) => void;
}

function findResourceByTarget(
  resources: CloudFormationResources,
  roleResourceTarget: RoleResourceTarget
) {
  let result: CloudFormationResource | null = null;

  if (roleResourceTarget.Id) {
    result = resources[roleResourceTarget.Id] ?? null;
  }

  if ('Ref' in roleResourceTarget.Arn) {
    result = resources[roleResourceTarget.Arn.Ref] ?? null;
  }

  if ('Fn::GetAtt' in roleResourceTarget.Arn) {
    const getAtt = roleResourceTarget.Arn['Fn::GetAtt'] as [
      string,
      keyof CloudFormationResource
    ];

    const [resourceName] = getAtt;

    result = resources[resourceName] ?? null;
  }

  if (!result) {
    throw new Error(
      `Resource not found: ${
        'Ref' in roleResourceTarget.Arn
          ? roleResourceTarget.Arn.Ref
          : roleResourceTarget.Arn['Fn::GetAtt'][1]
      }`
    );
  }

  return result;
}

export async function createTargets({
  resources,
  config,
  eventBridgeClient,
  rule,
  bus,
  logDebug,
}: CreateTargetsParams) {
  const eventBridgeMaxTargets = 5;

  const eventRulesResources = filterResources(
    resources,
    ServerlessResourceTypes.EVENTS_RULE
  );

  const existingTargetsForRule = await listRuleTargets({
    client: eventBridgeClient,
    ruleName: rule.Name as string,
    eventBusName: rule.EventBusName,
  });

  const definedRuleTargets: Array<RoleResourceTarget> =
    (eventRulesResources.find(
      (ruleResource) =>
        rule.Name === ruleResource.resourceDefinition.Properties['Name']
    )?.resourceDefinition.Properties['Targets'] as Array<RoleResourceTarget>) ||
    [];

  const notExistingTargets = definedRuleTargets.reduce<Set<RoleResourceTarget>>(
    (accumulator, targetResource) => {
      const targetId = targetResource.Id;

      const doesNotExist = !existingTargetsForRule.some(
        (existingTarget: Target) => existingTarget.Id === targetId
      );

      if (doesNotExist) {
        accumulator.add(targetResource);
      }

      return accumulator;
    },
    new Set()
  );

  logDebug(`Not existing targets: ${JSON.stringify([...notExistingTargets])}`);

  if (
    notExistingTargets.size > 0 &&
    existingTargetsForRule.length >= eventBridgeMaxTargets
  ) {
    throw new Error(
      `Max targets for rule: ${bus.Name} reached. Can not create new targets. Max targets: ${eventBridgeMaxTargets}`
    );
  }

  const ruleTargets = [...notExistingTargets].map((resourceTarget) => {
    let Arn: string;
    let sqsParameters: any;

    const targetResource = findResourceByTarget(resources, resourceTarget);

    switch (targetResource.Type) {
      case ServerlessResourceTypes.SNS_TOPIC: {
        Arn = snsTargetHandler({
          targetResource,
          awsConfig: config?.awsConfig,
        }).arn;
        break;
      }
      case ServerlessResourceTypes.SQS_QUEUE: {
        const sqsResult = sqsTargetHandler({
          targetResource,
          awsConfig: config?.awsConfig,
          roleResourceTarget: resourceTarget,
        });
        Arn = sqsResult.arn;
        sqsParameters = sqsResult.sqsParameters;
        break;
      }
      default: {
        throw new Error(
          `Resource type ${targetResource.Type} not implemented.`
        );
      }
    }

    const result: Target = {
      Id: resourceTarget.Id,
      Arn,
      ...(sqsParameters && { SqsParameters: sqsParameters }),
    };

    return result;
  });

  await createRuleTargets({
    client: eventBridgeClient,
    ruleName: rule.Name as string,
    eventBusName: rule.EventBusName,
    targets: ruleTargets,
  });

  return { ruleName: rule.Name, createdTargets: ruleTargets };
}
