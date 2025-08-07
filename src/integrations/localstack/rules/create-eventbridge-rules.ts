import { CloudFormationResources } from 'serverless/aws';
import { EventBridgeClient, EventBus } from '@aws-sdk/client-eventbridge';
import {
  RoleResourceTarget,
  RuleResourceProperties,
  createEventBusRule,
  listAllBuses,
  listBusRules,
} from '../utils';
import {
  ServerlessResourceTypes,
  filterResources,
} from '../../../utils/serverless';

export interface CreateEventBridgeRulesParams {
  resources: CloudFormationResources;
  eventBridgeClient: EventBridgeClient;
  logDebug: (message: string) => void;
}

type EventBusWithRef = EventBus & { Ref: string };

function getMatchingEventBusName(
  ruleProperties: RuleResourceProperties,
  bus: EventBusWithRef | EventBus
): string | null {
  const eventBusName = ruleProperties.EventBusName as
    | string
    | RoleResourceTarget['Arn'];

  if (typeof eventBusName === 'string') {
    const isMatching =
      (!eventBusName && bus.Name === 'default') ||
      (eventBusName && (eventBusName === bus.Name || eventBusName === bus.Arn));

    if (isMatching) {
      return eventBusName;
    }

    return null;
  }

  if ('Ref' in eventBusName && eventBusName.Ref === bus.Name) {
    return eventBusName.Ref;
  }

  if ('Fn::GetAtt' in eventBusName) {
    const busRef = 'Ref' in bus ? bus.Ref : bus.Arn;

    if (eventBusName['Fn::GetAtt'][0] === busRef) {
      return bus.Name!;
    }

    const busValue = bus[eventBusName['Fn::GetAtt'][1] as keyof EventBus];

    if (eventBusName['Fn::GetAtt'][0] === busValue) {
      return busValue!;
    }

    return null;
  }

  // const isMatching =
  //   ('Ref' in eventBusName && eventBusName.Ref === bus.Name) ||
  //   ('Arn' in eventBusName && eventBusName.Arn === bus.Arn) ||
  //   ('Fn::GetAtt' in eventBusName &&
  //     (eventBusName['Fn::GetAtt'][0] ===
  //       bus[eventBusName['Fn::GetAtt'][1] as keyof EventBus] ||
  //       eventBusName['Fn::GetAtt'][0] === busRef));

  return null;
}

export function getBusResource(
  resources: CloudFormationResources,
  bus: EventBus
): EventBusWithRef | null {
  const busResource = Object.entries(resources).find(
    ([_ref, resource]) =>
      resource.Type === ServerlessResourceTypes.EVENT_BUS &&
      resource.Properties['Name'] === bus.Name
  );

  if (!busResource) {
    return null;
  }

  return {
    ...bus,
    Ref: busResource[0],
  };
}

export async function createEventBridgeRules({
  resources,
  eventBridgeClient,
  logDebug,
}: CreateEventBridgeRulesParams) {
  const allBuses = await listAllBuses({
    client: eventBridgeClient,
  });

  const allCreatedRulesForBuses = await Promise.all(
    allBuses.map(async (bus) => {
      const busResource = getBusResource(resources, bus);

      const eventBridgeMaxRules = 300;

      const eventRulesResources = filterResources(
        resources,
        ServerlessResourceTypes.EVENTS_RULE
      );

      const existingRules = await listBusRules({
        client: eventBridgeClient,
        eventBusName: bus.Name as string,
      });

      const notExistingRules = eventRulesResources.reduce<
        Set<RuleResourceProperties>
      >((accumulator, ruleResource) => {
        const ruleProperties = ruleResource.resourceDefinition
          .Properties as RuleResourceProperties;

        const doesNotExist = !existingRules.some(
          (existingRule) => existingRule.Name === ruleProperties.Name
        );

        const matchingBusName = getMatchingEventBusName(
          ruleProperties,
          busResource ?? bus
        );

        if (doesNotExist && matchingBusName) {
          accumulator.add({
            ...ruleProperties,
            EventBusName: matchingBusName,
          });
        }

        return accumulator;
      }, new Set());

      logDebug(`Not existing rules: ${JSON.stringify([...notExistingRules])}`);

      if (
        notExistingRules.size > 0 &&
        existingRules.length >= eventBridgeMaxRules
      ) {
        throw new Error(
          `Max rules for bus: ${bus.Name} reached. Can not create new rules. Max rules: ${eventBridgeMaxRules}`
        );
      }

      const allCreatedRules = await Promise.all(
        [...notExistingRules].map(async (notExistingRule) => {
          return createEventBusRule({
            client: eventBridgeClient,
            ruleProperties: notExistingRule,
          });
        })
      );

      return { busName: bus.Name, allCreatedRules };
    })
  );

  return allCreatedRulesForBuses;
}
