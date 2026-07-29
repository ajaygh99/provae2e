import {
  buildNativeGestureActions,
  performNativeGesture
} from '../../src/core/native-appium-gestures';
import type { AppiumFetch } from '../../src/core/native-appium-runner';

describe('native Appium gestures', () => {
  it('builds bounded tap and swipe W3C actions', () => {
    expect(buildNativeGestureActions({ type: 'tap', at: { x: 10, y: 20 } })).toHaveLength(1);
    const swipe = buildNativeGestureActions({
      type: 'swipe',
      from: { x: 10, y: 500 },
      to: { x: 10, y: 100 },
      durationMs: 600
    });
    expect(JSON.stringify(swipe)).toContain('"pointerType":"touch"');
    expect(JSON.stringify(swipe)).toContain('"duration":600');
  });

  it('builds two synchronized fingers for pinch in and out', () => {
    expect(buildNativeGestureActions({
      type: 'pinch',
      center: { x: 500, y: 500 },
      distance: 100,
      scale: 0.5
    })).toHaveLength(2);
    expect(buildNativeGestureActions({
      type: 'pinch',
      center: { x: 500, y: 500 },
      distance: 50,
      scale: 2
    })).toHaveLength(2);
  });

  it('rejects unsafe coordinates, durations, stationary swipes, and invalid scale', () => {
    expect(() => buildNativeGestureActions({ type: 'tap', at: { x: -1, y: 0 } })).toThrow('coordinates');
    expect(() => buildNativeGestureActions({
      type: 'scroll', from: { x: 1, y: 1 }, to: { x: 1, y: 1 }
    })).toThrow('distinct');
    expect(() => buildNativeGestureActions({
      type: 'swipe', from: { x: 1, y: 2 }, to: { x: 2, y: 1 }, durationMs: 1
    })).toThrow('duration');
    expect(() => buildNativeGestureActions({
      type: 'pinch', center: { x: 100, y: 100 }, distance: 10, scale: 1
    })).toThrow('cannot equal 1');
  });

  it('posts actions then releases them', async () => {
    const methods: string[] = [];
    const fetcher: AppiumFetch = jest.fn(async (_input, init) => {
      methods.push(init?.method ?? 'GET');
      return { ok: true, status: 200, json: async () => ({ value: null }) };
    });
    await performNativeGesture('http://localhost:4723/', 'session/25', {
      type: 'tap', at: { x: 10, y: 20 }
    }, fetcher);
    expect(methods).toEqual(['POST', 'DELETE']);
  });

  it('reports Appium action failures without releasing unperformed actions', async () => {
    const fetcher: AppiumFetch = jest.fn(async () => ({
      ok: false, status: 500, json: async () => ({})
    }));
    await expect(performNativeGesture('http://localhost:4723', 'session', {
      type: 'tap', at: { x: 1, y: 1 }
    }, fetcher)).rejects.toThrow('HTTP 500');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
