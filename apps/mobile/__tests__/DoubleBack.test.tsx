/**
 * Double back to exit — the rule and the hook.
 *
 * The rule is tested as a pure function (so the timing edges are exact), and the
 * hook is then exercised in a real component to prove registration on focus,
 * removal on blur, and that an open sheet defers instead of exiting.
 */

import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react-native';
import { BackHandler, Text, Button, View } from 'react-native';

// useFocusEffect needs a router tree; the hook's own logic is what is under test
// here, so treat the component as permanently focused.
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useFocusEffect: (cb: () => (() => void) | undefined) => {
      React.useEffect(cb, [cb]);
    },
  };
});

import { decideBack, useDoubleBackToExit, EXIT_WINDOW_MS, EXIT_MESSAGE } from '../lib/doubleBack';

describe('decideBack (the rule)', () => {
  it('first press shows the hint and does not exit', () => {
    const r = decideBack(null, 1000, false);
    expect(r.exit).toBe(false);
    expect(r.showHint).toBe(true);
    expect(r.arm).toBe(1000);
  });

  it('second press within the window exits', () => {
    const r = decideBack(1000, 1000 + EXIT_WINDOW_MS - 1, false);
    expect(r.exit).toBe(true);
    expect(r.showHint).toBe(false);
  });

  it('an exactly-2s press still counts as the second', () => {
    expect(decideBack(1000, 1000 + EXIT_WINDOW_MS, false).exit).toBe(true);
  });

  it('after the window it shows the hint again', () => {
    const r = decideBack(1000, 1000 + EXIT_WINDOW_MS + 1, false);
    expect(r.exit).toBe(false);
    expect(r.showHint).toBe(true);
  });

  it('never exits while an overlay is open', () => {
    // Even on what would be the second press.
    const r = decideBack(1000, 1200, true);
    expect(r.exit).toBe(false);
    expect(r.showHint).toBe(false);
    expect(r.arm).toBeNull();
  });

  it('a press while an overlay is open does not arm the exit', () => {
    const first = decideBack(null, 1000, true);
    expect(first.arm).toBeNull();
    // So the next press (nothing open now) is still the FIRST one.
    const second = decideBack(first.arm, 1200, false);
    expect(second.exit).toBe(false);
    expect(second.showHint).toBe(true);
  });
});

/** A tiny screen that uses the hook, so registration can be observed. */
function HomeLike({
  isOverlayOpen = false,
  onExit,
  platform = 'android',
}: {
  isOverlayOpen?: boolean;
  onExit: () => void;
  platform?: string;
}) {
  const { showHint } = useDoubleBackToExit({ isOverlayOpen, exit: onExit, platform });
  return (
    <View>
      <Text>{showHint ? EXIT_MESSAGE : 'no-hint'}</Text>
      <Button title="x" onPress={() => {}} />
    </View>
  );
}

describe('useDoubleBackToExit (the hook)', () => {
  let handlers: Array<() => boolean>;
  let removeSpy: jest.Mock;

  beforeEach(() => {
    handlers = [];
    removeSpy = jest.fn();
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation(((
      _event: string,
      cb: () => boolean,
    ) => {
      handlers.push(cb);
      return { remove: removeSpy } as never;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Simulate one hardware back press. */
  const pressBack = () => {
    let handled = false;
    act(() => {
      for (const h of handlers) handled = h() || handled;
    });
    return handled;
  };

  it('registers a hardwareBackPress handler', () => {
    render(<HomeLike onExit={jest.fn()} />);
    expect(handlers.length).toBe(1);
  });

  it('first press shows the message and does not exit', () => {
    const onExit = jest.fn();
    render(<HomeLike onExit={onExit} />);
    const handled = pressBack();

    expect(handled).toBe(true);
    expect(onExit).not.toHaveBeenCalled();
    expect(screen.getByText(EXIT_MESSAGE)).toBeTruthy();
  });

  it('second press within the window exits', () => {
    const onExit = jest.fn();
    render(<HomeLike onExit={onExit} />);
    pressBack();
    pressBack();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('after the window the message shows again instead of exiting', () => {
    const onExit = jest.fn();
    // Control time explicitly so the window edge is deterministic.
    let now = 1_000_000;
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    render(<HomeLike onExit={onExit} />);

    pressBack();
    now += EXIT_WINDOW_MS + 500; // too slow
    pressBack();

    expect(onExit).not.toHaveBeenCalled();
    expect(screen.getByText(EXIT_MESSAGE)).toBeTruthy();
    spy.mockRestore();
  });

  it('does not exit while the sheet/reader is open', () => {
    const onExit = jest.fn();
    render(<HomeLike isOverlayOpen onExit={onExit} />);

    pressBack();
    pressBack();

    expect(onExit).not.toHaveBeenCalled();
    // And it never even showed the message.
    expect(screen.getByText('no-hint')).toBeTruthy();
  });

  it('removes the handler on unmount (blur)', () => {
    const { unmount } = render(<HomeLike onExit={jest.fn()} />);
    unmount();
    expect(removeSpy).toHaveBeenCalled();
  });

  it('registers nothing on iOS', () => {
    render(<HomeLike platform="ios" onExit={jest.fn()} />);
    expect(handlers.length).toBe(0);
  });

  it('uses the real BackHandler.exitApp when no exit fn is given', () => {
    const exitSpy = jest.spyOn(BackHandler, 'exitApp').mockImplementation(() => {});
    function NoExitFn() {
      useDoubleBackToExit({ isOverlayOpen: false, platform: 'android' });
      return <View />;
    }
    render(<NoExitFn />);
    pressBack();
    pressBack();
    expect(exitSpy).toHaveBeenCalledTimes(1);
  });
});
