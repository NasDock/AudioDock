#import "WidgetCommandEmitter.h"

@implementation WidgetCommandEmitter {
  BOOL hasListeners;
}

static WidgetCommandEmitter *_shared = nil;

RCT_EXPORT_MODULE();

+ (void)sendCommand:(NSString *)command payload:(NSDictionary *)payload {
  if (_shared && _shared->hasListeners) {
    NSDictionary *safePayload = payload ?: @{};
    [_shared sendEventWithName:@"widgetCommand"
                          body:@{ @"action": command ?: @"",
                                  @"payload": safePayload }];
  }
}

- (instancetype)init {
  self = [super init];
  if (self) {
    _shared = self;
  }
  return self;
}

- (NSArray<NSString *> *)supportedEvents {
  return @[@"widgetCommand"];
}

- (void)startObserving {
  hasListeners = YES;
}

- (void)stopObserving {
  hasListeners = NO;
}

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

@end
