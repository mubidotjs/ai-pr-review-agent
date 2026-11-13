import { PrivateRelay } from './relay';
export function releaseConfig(env = process.env) {
  return {
    accessCode: env.PRISM_ACCESS_CODE ?? '',
    sessionSecret: env.PRISM_SESSION_SECRET ?? '',
    relay: new PrivateRelay(
      env.PRISM_AI_ORIGIN ?? '',
      env.PRISM_RELAY_SECRET ?? '',
    ),
  };
}
