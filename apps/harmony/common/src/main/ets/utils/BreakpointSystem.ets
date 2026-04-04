import { mediaquery } from '@kit.ArkUI';
import { commonConstants } from '../constants/CommonConstants';

declare interface BreakPointTypeOption<T> extends Record<string, T | undefined> {
  sm?: T;
  md?: T;
  lg?: T;
  xl?: T;
  xxl?: T;
}

export class BreakPointType<T> {
  options: BreakPointTypeOption<T>;

  constructor(option: BreakPointTypeOption<T>) {
    this.options = option;
  }

  getValue(currentBreakPoint: string): T {
    return this.options[currentBreakPoint] as T;
  }
}

class Breakpoint {
  name: string = '';
  size: number = 0;
  mediaQueryListener?: mediaquery.MediaQueryListener;
}

export class BreakpointSystem {
  private currentBreakpoint: string = commonConstants.breakpointsInitializeName;
  private readonly breakpointId: string = commonConstants.breakpointIdInitializeName;
  private readonly breakpoints: Breakpoint[] = [
    { name: commonConstants.breakpointsSmName, size: commonConstants.breakpointsSmSize },
    { name: commonConstants.breakpointsMdName, size: commonConstants.breakpointsMdSize },
    { name: commonConstants.breakpointsLgName, size: commonConstants.breakpointsLgSize },
    { name: commonConstants.breakpointsXlName, size: commonConstants.breakpointsXlSize }
  ];

  constructor(breakpointId: string) {
    this.breakpointId = breakpointId;
  }

  public register(uiContext: UIContext): void {
    this.breakpoints.forEach((breakpoint: Breakpoint, index: number) => {
      let condition: string = '';
      if (index === this.breakpoints.length - 1) {
        condition = `(${breakpoint.size}vp<=width)`;
      } else {
        condition = `(${breakpoint.size}vp<=width<${this.breakpoints[index + 1].size}vp)`;
      }

      breakpoint.mediaQueryListener = uiContext.getMediaQuery().matchMediaSync(condition);
      breakpoint.mediaQueryListener.on('change', (mediaQueryResult: mediaquery.MediaQueryResult) => {
        if (mediaQueryResult.matches) {
          this.updateCurrentBreakpoint(breakpoint.name);
        }
      });
    });
  }

  public unregister(): void {
    this.breakpoints.forEach((breakpoint: Breakpoint) => {
      breakpoint.mediaQueryListener?.off('change');
    });
  }

  private updateCurrentBreakpoint(breakpoint: string): void {
    if (this.currentBreakpoint !== breakpoint) {
      this.currentBreakpoint = breakpoint;
      AppStorage.set<string>(this.breakpointId, this.currentBreakpoint);
    }
  }
}