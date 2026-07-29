import type { AppiumFetch } from './native-appium-runner.js';

export interface Point { x: number; y: number }
export type NativeGesture =
  | { type: 'tap'; at: Point }
  | { type: 'swipe'; from: Point; to: Point; durationMs?: number }
  | { type: 'scroll'; from: Point; to: Point; durationMs?: number }
  | { type: 'pinch'; center: Point; distance: number; scale: number; durationMs?: number };

interface PointerAction {
  type: string;
  duration?: number;
  x?: number;
  y?: number;
  button?: number;
}

const MAX_COORDINATE = 100_000;

function validatePoint(point: Point): void {
  if (![point.x, point.y].every((value) =>
    Number.isInteger(value) && value >= 0 && value <= MAX_COORDINATE)) {
    throw new Error('Gesture coordinates must be integers between 0 and 100000');
  }
}

function duration(value = 500): number {
  if (!Number.isInteger(value) || value < 50 || value > 10_000) {
    throw new Error('Gesture duration must be an integer between 50 and 10000 ms');
  }
  return value;
}

function finger(id: string, actions: PointerAction[]): object {
  return { type: 'pointer', id, parameters: { pointerType: 'touch' }, actions };
}

export function buildNativeGestureActions(gesture: NativeGesture): object[] {
  if (gesture.type === 'tap') {
    validatePoint(gesture.at);
    return [finger('finger-1', [
      { type: 'pointerMove', duration: 0, ...gesture.at },
      { type: 'pointerDown', button: 0 },
      { type: 'pause', duration: 50 },
      { type: 'pointerUp', button: 0 }
    ])];
  }
  if (gesture.type === 'swipe' || gesture.type === 'scroll') {
    validatePoint(gesture.from);
    validatePoint(gesture.to);
    if (gesture.from.x === gesture.to.x && gesture.from.y === gesture.to.y) {
      throw new Error('Swipe and scroll gestures require distinct points');
    }
    return [finger('finger-1', [
      { type: 'pointerMove', duration: 0, ...gesture.from },
      { type: 'pointerDown', button: 0 },
      { type: 'pointerMove', duration: duration(gesture.durationMs), ...gesture.to },
      { type: 'pointerUp', button: 0 }
    ])];
  }

  validatePoint(gesture.center);
  const gestureDuration = duration(gesture.durationMs);
  if (!Number.isInteger(gesture.distance) || gesture.distance < 1 || gesture.distance > 10_000) {
    throw new Error('Pinch distance must be an integer between 1 and 10000');
  }
  if (!Number.isFinite(gesture.scale) || gesture.scale < 0.1 || gesture.scale > 10 || gesture.scale === 1) {
    throw new Error('Pinch scale must be between 0.1 and 10 and cannot equal 1');
  }
  const startDistance = gesture.scale < 1 ? gesture.distance : Math.round(gesture.distance * gesture.scale);
  const endDistance = gesture.scale < 1 ? Math.round(gesture.distance * gesture.scale) : gesture.distance;
  const points = (distanceValue: number): [Point, Point] => [
    { x: gesture.center.x - distanceValue, y: gesture.center.y },
    { x: gesture.center.x + distanceValue, y: gesture.center.y }
  ];
  const [startOne, startTwo] = points(startDistance);
  const [endOne, endTwo] = points(endDistance);
  [startOne, startTwo, endOne, endTwo].forEach(validatePoint);
  return [
    finger('finger-1', [
      { type: 'pointerMove', duration: 0, ...startOne },
      { type: 'pointerDown', button: 0 },
      { type: 'pointerMove', duration: gestureDuration, ...endOne },
      { type: 'pointerUp', button: 0 }
    ]),
    finger('finger-2', [
      { type: 'pointerMove', duration: 0, ...startTwo },
      { type: 'pointerDown', button: 0 },
      { type: 'pointerMove', duration: gestureDuration, ...endTwo },
      { type: 'pointerUp', button: 0 }
    ])
  ];
}

export async function performNativeGesture(
  appiumUrl: string,
  sessionId: string,
  gesture: NativeGesture,
  fetcher: AppiumFetch = fetch as AppiumFetch
): Promise<void> {
  const base = `${appiumUrl.replace(/\/+$/, '')}/session/${encodeURIComponent(sessionId)}/actions`;
  const response = await fetcher(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actions: buildNativeGestureActions(gesture) })
  });
  if (!response.ok) {
    throw new Error(`Native gesture failed with HTTP ${response.status}`);
  }
  const release = await fetcher(base, { method: 'DELETE' });
  if (!release.ok) {
    throw new Error(`Native gesture release failed with HTTP ${release.status}`);
  }
}
