interface ScreenshotAPI {
  onScreenshotStart(callback: (imageData: string) => void): void;
  cancel(): void;
  copyToClipboard(dataUrl: string): void;
  submitBug(data: any): Promise<any>;
  getUsers(): Promise<any>;
}

declare global {
  interface Window {
    screenshotAPI: ScreenshotAPI;
  }
}

export {};
