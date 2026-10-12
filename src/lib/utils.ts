import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 判断当前设备/浏览器是否为 iOS / iPadOS。
 *   - iPhone / iPod / 旧 iPad：UA 直接含 iPhone/iPad/iPod
 *   - iPadOS 13+：Safari 默认把 UA 伪装成 macOS，需靠「平台是 Mac + 有多点触控」识别
 * 这些设备对标准 Fullscreen API 支持很差（普通元素基本无法进全屏，
 * 且 fullscreenchange 行为不可靠），因此需要单独识别并跳过强制全屏逻辑。
 */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ 伪装成 Mac：平台为 MacIntel 且支持多点触控（真 Mac 触控点为 0）
  const isTouchMac =
    navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
  return isTouchMac;
}

/**
 * 判断当前环境是否可以启用「强制全屏」逻辑。
 *   条件：
 *     1. 不是 iOS / iPadOS（这些设备全屏不可靠，一律不强制，避免被误踢出学习页）；
 *     2. 浏览器真实存在标准 requestFullscreen API。
 * 返回 false 时，调用方应跳过请求全屏 + 跳过「退出全屏 → 返回选择页」的逻辑，
 * 让页面在这些设备上正常使用。
 */
export function canUseForcedFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  if (isIOS()) return false;
  return typeof document.documentElement.requestFullscreen === 'function';
}
