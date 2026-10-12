#import <React/RCTBridgeModule.h>
#if __has_include(<AppbaseReactNative/AppbaseReactNative-Swift.h>)
#import <AppbaseReactNative/AppbaseReactNative-Swift.h>
#else
#import "AppbaseReactNative-Swift.h"
#endif

/// Resolves only the coarse build environment: development, sandbox, production or unknown.
@interface AppbaseRuntime : NSObject <RCTBridgeModule>
@end

@implementation AppbaseRuntime
RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

RCT_EXPORT_METHOD(detectRuntimeEnvironment : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject) {
  [AppbaseRuntimeDetector detectWithCompletion:^(NSString *environment) {
    resolve(environment);
  }];
}
@end
