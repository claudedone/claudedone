import type { ComponentPropsWithoutRef } from 'react';

/** Native keyboard and form semantics with the NodeCloak switch treatment. */
export default function Toggle(props: Omit<ComponentPropsWithoutRef<'input'>, 'type' | 'role'>) {
  return <span className="toggle-control"><input {...props} type="checkbox" role="switch" /><span className="switch" aria-hidden="true" /></span>;
}
