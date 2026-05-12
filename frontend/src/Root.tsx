import React from 'react';
import './index.less';
import App from './components/App';
import ErrorBoundary from './components/ErrorBoundery';

export default function Root() {
    return (
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    );
}
