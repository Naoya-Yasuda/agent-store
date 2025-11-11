import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

function Greeting({ name = 'world' }: { name?: string }) {
  return <p>hello {name}</p>;
}

describe('Greeting component', () => {
  it('shows default text', () => {
    render(<Greeting />);
    expect(screen.getByText(/hello world/i)).toBeInTheDocument();
  });

  it('renders custom name', () => {
    render(<Greeting name="Judge" />);
    expect(screen.getByText(/hello Judge/i)).toBeInTheDocument();
  });
});
