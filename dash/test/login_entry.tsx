import { createRoot } from 'react-dom/client';
import LoginForm from '../app/login/LoginForm';
createRoot(document.getElementById('r')!).render(<LoginForm next="/dashboard" />);
