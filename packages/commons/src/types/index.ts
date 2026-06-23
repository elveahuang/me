import { JSX, LazyExoticComponent } from 'react';

export type LazyComponent = LazyExoticComponent<() => JSX.Element>;
