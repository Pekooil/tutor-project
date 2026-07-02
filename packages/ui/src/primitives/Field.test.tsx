import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Field } from './Field';

describe('Field', () => {
  it('associates the label with the control via htmlFor/id', () => {
    render(
      <Field label="Email">
        <input type="email" />
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input.tagName).toBe('INPUT');
  });

  it('keeps an existing control id instead of overwriting it', () => {
    render(
      <Field label="Email">
        <input id="signup-email" type="email" />
      </Field>,
    );
    expect(screen.getByLabelText('Email').id).toBe('signup-email');
  });

  it('associates an error via aria-describedby, marks aria-invalid, and renders role="alert"', () => {
    render(
      <Field label="Email" error="Required">
        <input />
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();

    const errorEl = document.getElementById(describedBy!);
    expect(errorEl?.textContent).toBe('Required');
    expect(errorEl?.getAttribute('role')).toBe('alert');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('associates a hint via aria-describedby when there is no error', () => {
    render(
      <Field label="Email" hint="We never share this">
        <input />
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    const describedBy = input.getAttribute('aria-describedby');
    const hintEl = document.getElementById(describedBy!);
    expect(hintEl?.textContent).toBe('We never share this');
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('prefers the error over the hint when both are present', () => {
    render(
      <Field label="Email" hint="We never share this" error="Required">
        <input />
      </Field>,
    );
    expect(screen.getByText('Required')).toBeTruthy();
    expect(screen.queryByText('We never share this')).toBeNull();
  });

  it('marks aria-required when required is set', () => {
    render(
      <Field label="Email" required>
        <input />
      </Field>,
    );
    expect(screen.getByLabelText(/Email/).getAttribute('aria-required')).toBe('true');
  });
});
