import { hilog } from '@kit.PerformanceAnalysisKit';

export class Logger {
  private readonly prefix: string = 'testTag';
  private readonly domain: number = 0xFF00;
  private readonly format: string = '%{public}s, %{public}s';

  public debug(...args: string[]): void {
    hilog.debug(this.domain, this.prefix, this.format, args);
  }

  public info(...args: string[]): void {
    hilog.info(this.domain, this.prefix, this.format, args);
  }

  public warn(...args: string[]): void {
    hilog.warn(this.domain, this.prefix, this.format, args);
  }

  public error(...args: string[]): void {
    hilog.error(this.domain, this.prefix, this.format, args);
  }
}