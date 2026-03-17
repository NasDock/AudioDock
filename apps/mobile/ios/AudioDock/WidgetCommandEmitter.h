#import <React/RCTEventEmitter.h>
#import <React/RCTBridgeModule.h>

@interface WidgetCommandEmitter : RCTEventEmitter <RCTBridgeModule>
+ (void)sendCommand:(NSString *)command payload:(NSDictionary *)payload;
@end
