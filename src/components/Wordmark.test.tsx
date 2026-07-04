import React from 'react';
import { render } from '@testing-library/react-native';
import { Wordmark } from './Wordmark';
import { MicButton } from './MicButton';

describe('component smoke tests', () => {
  it('Wordmark renders both halves of the brand', () => {
    const { getByText } = render(<Wordmark />);
    expect(getByText('Open')).toBeTruthy();
    expect(getByText('Flow')).toBeTruthy();
  });

  it('MicButton renders across statuses without throwing', () => {
    for (const status of ['idle', 'recording', 'transcribing'] as const) {
      const { toJSON, unmount } = render(<MicButton status={status} onPress={() => {}} />);
      expect(toJSON()).toBeTruthy();
      unmount();
    }
  });
});
