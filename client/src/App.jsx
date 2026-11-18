import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomeSelector from './components/HomeSelector';
import AssistiveController from './components/AssistiveController';
import GameLauncher from './components/GameLauncher';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeSelector />} />
        <Route path="/game" element={<GameLauncher />} />
        <Route path="/assistive" element={<AssistiveController />} />
      </Routes>
    </BrowserRouter>
  );
}
