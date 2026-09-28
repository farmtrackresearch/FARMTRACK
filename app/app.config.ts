/// <reference types="node" />
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Wraps app.json (the static config, passed in as `config`) to add the one
 * value that cannot live in git: the Firebase config Android needs for push
 * notifications.
 *
 * - EAS Build: GOOGLE_SERVICES_JSON is a file-type EAS environment variable,
 *   so its value is the path of the uploaded google-services.json.
 * - Local builds: ./google-services.json next to this file (git-ignored).
 * - Neither: the field is left out, so builds without Firebase still work;
 *   the app then just cannot get a push token on Android.
 */
export default ({ config, projectRoot }: ConfigContext): ExpoConfig => {
  const localFile = './google-services.json';
  const googleServicesFile =
    process.env.GOOGLE_SERVICES_JSON ?? (existsSync(join(projectRoot, localFile)) ? localFile : undefined);

  return {
    ...config,
    name: config.name ?? 'FarmTrack',
    slug: config.slug ?? 'farmtrack',
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
