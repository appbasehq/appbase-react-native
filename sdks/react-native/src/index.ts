/**
 * Entry outside a React Native app (Node, tests): no native build signal, so events carry no
 * build label, and `platform` must be passed. Metro resolves `index.native` in apps instead.
 */
import { factory } from './facade.js';
export * from './facade.js';

export const createReactNativeAnalytics = factory({});
