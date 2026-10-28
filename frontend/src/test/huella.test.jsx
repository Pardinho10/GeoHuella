import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import IconHuella from '../components/IconHuella.jsx';

describe('IconHuella', () => {
  it('dibuja una huella con cuatro dedos y una almohadilla', () => {
    const { container } = render(<IconHuella size={32} />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('width', '32');
    expect(svg).toHaveAttribute('height', '32');
    expect(svg.querySelectorAll('ellipse')).toHaveLength(4);
    expect(svg.querySelectorAll('path')).toHaveLength(1);
  });
});
