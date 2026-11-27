import { tool } from 'ai';
import { z } from 'zod';
import { getSystemStatus } from '../services/systemService.js';
import { controlMagnifier } from '../tools/relaxTools.js';
import { openApplication, runTerminalCommand, listOrKillProcess } from './tools/systemCliTools.js';
import { controlPower } from './tools/powerTools.js';
import { playYoutubeVideo, controlMediaPlayback } from './tools/youtubeTools.js';
import { openBrowserUrl, browserTabAction } from './tools/browserTools.js';
import { updateExcelCell, fileOperation } from './tools/officeFileTools.js';
import { captureAndAnalyzeScreen } from './tools/visionTools.js';

/**
 * AI Tool: Read system hardware & network status
 */
export const getSystemStatusTool = tool({
  description: 'قراءة تقرير حي عن حالة الجهاز (استهلاك الرام RAM، المعالج CPU، وقت التشغيل، ونظام التشغيل)',
  inputSchema: z.object({}),
  execute: async () => {
    const status = getSystemStatus();
    return { success: true, status };
  },
});

export const aiTools = {
  // 1. YouTube & Media
  playYoutubeVideo,
  controlMediaPlayback,
  // 2. Browser
  openBrowserUrl,
  browserTabAction,
  // 3. Office & Files
  updateExcelCell,
  fileOperation,
  // 4. Vision & Accessibility
  captureAndAnalyzeScreen,
  controlMagnifier,
  // 5. System & CLI
  openApplication,
  runTerminalCommand,
  listOrKillProcess,
  // 6. Power & Status
  controlPower,
  getSystemStatus: getSystemStatusTool,
};

export {
  playYoutubeVideo,
  controlMediaPlayback,
  openBrowserUrl,
  browserTabAction,
  updateExcelCell,
  fileOperation,
  captureAndAnalyzeScreen,
  controlMagnifier,
  openApplication,
  runTerminalCommand,
  listOrKillProcess,
  controlPower,
};
