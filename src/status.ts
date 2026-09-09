import { requireElement } from './dom';

const statusMessage = requireElement('statusMessage');

export type StatusType = 'info' | 'error' | 'success';

export function showStatus(message: string, type: StatusType = 'info'): void {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
}
