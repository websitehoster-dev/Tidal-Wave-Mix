import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Play, RotateCcw, Upload, Music } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PLAYER_X = 200;
const BLOCK_W = 60;
const GAP_SIZE = 240;

type Obstacle = {
  id: number;
  x: number;
  width: number;
  isTop: boolean;
  points: {x: number, y: number}[];
  hasSpikes: boolean[];
  vy: number;
  yOffset: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
};

type PortalType = 'speed_0' | 'speed_1' | 'speed_2' | 'speed_3' | 'speed_4' | 'mini' | 'normal';

type Difficulty = 'Harder' | 'Insane' | 'Easy Demon' | 'Medium Demon' | 'Hard Demon' | 'Insane Demon' | 'Extreme Demon';

const DIFFICULTY_PROPS: Record<Difficulty, { baseGap: number, shrinkRate: number, horizontalGapBase: number, horizontalGapVar: number, hue: number }> = {
  'Harder': { baseGap: 220, shrinkRate: 0.2, horizontalGapBase: 180, horizontalGapVar: 60, hue: 210 },
  'Insane': { baseGap: 190, shrinkRate: 0.4, horizontalGapBase: 140, horizontalGapVar: 50, hue: 280 },
  'Easy Demon': { baseGap: 160, shrinkRate: 0.6, horizontalGapBase: 100, horizontalGapVar: 50, hue: 120 },
  'Medium Demon': { baseGap: 140, shrinkRate: 0.8, horizontalGapBase: 80, horizontalGapVar: 40, hue: 60 },
  'Hard Demon': { baseGap: 120, shrinkRate: 1.0, horizontalGapBase: 60, horizontalGapVar: 40, hue: 30 },
  'Insane Demon': { baseGap: 100, shrinkRate: 1.2, horizontalGapBase: 40, horizontalGapVar: 30, hue: 0 },
  'Extreme Demon': { baseGap: 85, shrinkRate: 1.5, horizontalGapBase: 20, horizontalGapVar: 20, hue: 350 },
};

type Portal = {
  id: number;
  x: number;
  y: number;
  type: PortalType;
  collected: boolean;
};

type GameState = {
  status: 'menu' | 'playing' | 'gameover' | 'level_complete';
  score: number;
  highScore: number;
  player: {
    y: number;
    screenX: number;
    isHolding: boolean;
    trail: { x: number; y: number }[];
    rotation: number;
    size: number;
    speedLevel: number;
    isMini: boolean;
  };
  cameraX: number;
  obstacles: Obstacle[];
  particles: Particle[];
  portals: Portal[];
  gapCenter: number;
  trend: number;
  trendLength: number;
  nextPortalX: number;
  portalIndex: number;
  generatedSpeedLevel: number;
  generatedIsMini: boolean;
  difficulty: Difficulty;
  customPortals?: { x: number, type: PortalType, time: number }[];
  customPortalIndex: number;
  botEnabled: boolean;
  lastY2: number;
  lastX2: number;
  themeIndex: number;
  themeTransition: number;
  levelCompleteTimer: number;
  gameoverTimer: number;
};

const PORTAL_SEQUENCE: PortalType[] = [
  'speed_2', 'speed_3', 'speed_4', 'speed_3', 'speed_2', 'speed_1', 'speed_0', 'speed_1', 'speed_2', 
  'speed_3', 'speed_4', 'speed_3', 'speed_2', 'speed_1', 'speed_0', 'speed_1', 'speed_2', 'speed_3'
];

async function analyzeAudio(file: File): Promise<{ beats: number[], energyProfile: number[], url: string, bpm: number }> {
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new AudioContext();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  
  const offlineLow = new OfflineAudioContext(1, audioBuffer.length, audioBuffer.sampleRate);
  const sourceLow = offlineLow.createBufferSource();
  sourceLow.buffer = audioBuffer;
  const filterLow = offlineLow.createBiquadFilter();
  filterLow.type = 'lowpass';
  filterLow.frequency.value = 150;
  sourceLow.connect(filterLow);
  filterLow.connect(offlineLow.destination);
  sourceLow.start(0);
  const renderedLow = await offlineLow.startRendering();
  const dataLow = renderedLow.getChannelData(0);

  const offlineHigh = new OfflineAudioContext(1, audioBuffer.length, audioBuffer.sampleRate);
  const sourceHigh = offlineHigh.createBufferSource();
  sourceHigh.buffer = audioBuffer;
  const filterHigh = offlineHigh.createBiquadFilter();
  filterHigh.type = 'highpass';
  filterHigh.frequency.value = 2000;
  sourceHigh.connect(filterHigh);
  filterHigh.connect(offlineHigh.destination);
  sourceHigh.start(0);
  const renderedHigh = await offlineHigh.startRendering();
  const dataHigh = renderedHigh.getChannelData(0);

  const windowSize = Math.floor(audioBuffer.sampleRate * 0.05); // 50ms windows
  const beats: number[] = [];
  const energyProfile: number[] = [];
  
  let maxEnergy = 0;
  for (let i = 0; i < dataLow.length; i += windowSize) {
    let sumLow = 0, sumHigh = 0;
    let count = 0;
    for (let j = 0; j < windowSize && i + j < dataLow.length; j++) {
      sumLow += dataLow[i + j] * dataLow[i + j];
      sumHigh += dataHigh[i + j] * dataHigh[i + j];
      count++;
    }
    const rmsLow = Math.sqrt(sumLow / count);
    const rmsHigh = Math.sqrt(sumHigh / count);
    const totalEnergy = rmsLow + rmsHigh;
    energyProfile.push(totalEnergy);
    if (totalEnergy > maxEnergy) maxEnergy = totalEnergy;
  }

  // Normalize energy profile
  for (let i = 0; i < energyProfile.length; i++) {
    energyProfile[i] /= (maxEnergy || 1);
  }

  // Detect beats based on energy peaks
  let lastBeatTime = -1;
  for (let i = 1; i < energyProfile.length - 1; i++) {
    // Check if it's a local peak and above a threshold
    if (energyProfile[i] > energyProfile[i - 1] && energyProfile[i] > energyProfile[i + 1]) {
      // Dynamic threshold based on local average
      let localSum = 0;
      const localWindow = 10; // 500ms
      let localCount = 0;
      for (let j = Math.max(0, i - localWindow); j < Math.min(energyProfile.length, i + localWindow); j++) {
        localSum += energyProfile[j];
        localCount++;
      }
      const localAvg = localSum / localCount;
      
      if (energyProfile[i] > localAvg * 1.5 && energyProfile[i] > 0.1) {
        const time = i * windowSize / audioBuffer.sampleRate;
        if (time - lastBeatTime > 0.2) { // min 200ms between beats
          beats.push(time);
          lastBeatTime = time;
        }
      }
    }
  }

  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) {
    const diff = beats[i] - beats[i - 1];
    if (diff > 0.2 && diff < 2.0) {
      intervals.push(diff);
    }
  }
  
  const buckets: Record<string, number> = {};
  for (const interval of intervals) {
    const bucket = Math.round(interval * 50) / 50;
    buckets[bucket] = (buckets[bucket] || 0) + 1;
  }
  
  let bestInterval = 0.5;
  let maxCount = 0;
  for (const [bucketStr, count] of Object.entries(buckets)) {
    if (count > maxCount) {
      maxCount = count;
      bestInterval = parseFloat(bucketStr);
    }
  }
  
  const bpm = Math.round(60 / bestInterval);
  const url = URL.createObjectURL(file);
  return { beats, energyProfile, url, bpm };
}

function generateCustomPortals(beats: number[], energyProfile: number[]): { x: number, type: PortalType, time: number }[] {
  const portals: { x: number, type: PortalType, time: number }[] = [];
  let currentX = PLAYER_X;
  let currentTime = 0;
  let currentSpeedLevel = 1;
  let currentMini = false;
  
  if (beats.length < 2) return portals;

  // Calculate average energy
  const avgEnergy = energyProfile.reduce((a, b) => a + b, 0) / energyProfile.length;

  for (let i = 0; i < beats.length; i++) {
    const beatTime = beats[i];

    const dt = beatTime - currentTime;
    const currentSpeedX = currentSpeedLevel === 0 ? 350 : currentSpeedLevel === 1 ? 450 : currentSpeedLevel === 2 ? 580 : currentSpeedLevel === 3 ? 720 : 900;
    
    currentX += currentSpeedX * dt;
    currentTime = beatTime;

    // We only want to place portals at least 3 seconds apart to avoid spam
    const timeSinceLastPortal = portals.length > 0 ? beatTime - portals[portals.length - 1].time : beatTime;
    
    if (timeSinceLastPortal < 3.0) continue;

    // Determine target speed based on local energy around this beat
    const windowIndex = Math.floor(beatTime / 0.05); // 50ms windows
    let localEnergySum = 0;
    let localCount = 0;
    for (let j = Math.max(0, windowIndex - 20); j < Math.min(energyProfile.length, windowIndex + 40); j++) { // 1 sec before, 2 sec after
      localEnergySum += energyProfile[j];
      localCount++;
    }
    const localEnergy = localEnergySum / localCount;

    let targetSpeedLevel = 1;
    let targetMini = false;
    if (localEnergy > avgEnergy * 1.8) { targetSpeedLevel = 4; targetMini = true; }
    else if (localEnergy > avgEnergy * 1.3) { targetSpeedLevel = 3; targetMini = true; }
    else if (localEnergy > avgEnergy * 0.8) { targetSpeedLevel = 2; targetMini = false; }
    else if (localEnergy > avgEnergy * 0.4) { targetSpeedLevel = 1; targetMini = false; }
    else { targetSpeedLevel = 0; targetMini = false; }

    let type: PortalType | null = null;

    // Decide what portal to place
    if (targetSpeedLevel !== currentSpeedLevel) {
      if (targetSpeedLevel === 0) type = 'speed_0';
      else if (targetSpeedLevel === 1) type = 'speed_1';
      else if (targetSpeedLevel === 2) type = 'speed_2';
      else if (targetSpeedLevel === 3) type = 'speed_3';
      else if (targetSpeedLevel === 4) type = 'speed_4';
    }

    if (type) {
      portals.push({
        x: currentX,
        type,
        time: beatTime
      });
      if (type === 'speed_0') currentSpeedLevel = 0;
      if (type === 'speed_1') currentSpeedLevel = 1;
      if (type === 'speed_2') currentSpeedLevel = 2;
      if (type === 'speed_3') currentSpeedLevel = 3;
      if (type === 'speed_4') currentSpeedLevel = 4;
    }

    if (targetMini !== currentMini) {
      portals.push({
        x: currentX + (type ? 100 : 0), // offset slightly if speed portal was also placed
        type: targetMini ? 'mini' : 'normal',
        time: beatTime
      });
      currentMini = targetMini;
    }
  }

  return portals;
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

const THEMES = [
  { name: 'surface', bgTop: [195, 100, 70], bgBottom: [195, 100, 40], structBase: [210, 100, 40], structGlow: [195, 100, 60], spikeColor: [210, 100, 30] },
  { name: 'underwater', bgTop: [210, 100, 20], bgBottom: [230, 100, 5], structBase: [200, 90, 10], structGlow: [180, 100, 50], spikeColor: [160, 100, 60] },
  { name: 'deep_ocean', bgTop: [230, 80, 10], bgBottom: [250, 90, 2], structBase: [220, 80, 5], structGlow: [200, 100, 30], spikeColor: [180, 100, 40] },
  { name: 'abyss', bgTop: [250, 60, 5], bgBottom: [260, 80, 0], structBase: [240, 60, 2], structGlow: [220, 100, 15], spikeColor: [200, 100, 20] },
  { name: 'lava', bgTop: [10, 80, 20], bgBottom: [0, 100, 10], structBase: [15, 90, 15], structGlow: [5, 100, 40], spikeColor: [0, 100, 50] },
  { name: 'neon', bgTop: [280, 80, 15], bgBottom: [300, 90, 5], structBase: [290, 80, 10], structGlow: [310, 100, 40], spikeColor: [320, 100, 50] },
  { name: 'toxic', bgTop: [120, 80, 20], bgBottom: [140, 90, 10], structBase: [110, 80, 15], structGlow: [130, 100, 40], spikeColor: [100, 100, 50] },
  { name: 'blood', bgTop: [350, 80, 15], bgBottom: [360, 90, 5], structBase: [355, 80, 10], structGlow: [350, 100, 40], spikeColor: [0, 100, 50] },
];

function interpolateTheme(themeIndex: number, transition: number) {
  const currentTheme = THEMES[themeIndex % THEMES.length];
  const oldTheme = THEMES[(themeIndex - 1 + THEMES.length) % THEMES.length];
  
  const progress = transition; // 1.0 -> 0.0
  
  const lerp = (a: number[], b: number[]) => [
    a[0] + (b[0] - a[0]) * progress,
    a[1] + (b[1] - a[1]) * progress,
    a[2] + (b[2] - a[2]) * progress,
  ];

  return {
    theme1Name: currentTheme.name,
    theme2Name: oldTheme.name,
    transitionProgress: progress,
    bgTop: lerp(currentTheme.bgTop, oldTheme.bgTop),
    bgBottom: lerp(currentTheme.bgBottom, oldTheme.bgBottom),
    structBase: lerp(currentTheme.structBase, oldTheme.structBase),
    structGlow: lerp(currentTheme.structGlow, oldTheme.structGlow),
    spikeColor: lerp(currentTheme.spikeColor, oldTheme.spikeColor),
  };
}

const WaveBackground = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none z-0 opacity-60 mix-blend-screen">
    <motion.div 
      animate={{ x: ["0%", "-50%"] }}
      transition={{ repeat: Infinity, duration: 15, ease: "linear" }}
      className="absolute bottom-0 left-0 w-[200%] h-[60%]"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 320' preserveAspectRatio='none'%3E%3Cpath fill='%230891b2' fill-opacity='0.4' d='M 0,160 Q 200,320 400,160 T 800,160 L 800,320 L 0,320 Z'/%3E%3C/svg%3E")`,
        backgroundSize: '50% 100%',
        backgroundRepeat: 'repeat-x'
      }}
    />
    <motion.div 
      animate={{ x: ["-50%", "0%"] }}
      transition={{ repeat: Infinity, duration: 22, ease: "linear" }}
      className="absolute bottom-0 left-0 w-[200%] h-[50%]"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 320' preserveAspectRatio='none'%3E%3Cpath fill='%232563eb' fill-opacity='0.4' d='M 0,160 Q 200,40 400,160 T 800,160 L 800,320 L 0,320 Z'/%3E%3C/svg%3E")`,
        backgroundSize: '50% 100%',
        backgroundRepeat: 'repeat-x'
      }}
    />
    <motion.div 
      animate={{ x: ["0%", "-50%"] }}
      transition={{ repeat: Infinity, duration: 12, ease: "linear" }}
      className="absolute bottom-0 left-0 w-[200%] h-[40%]"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 320' preserveAspectRatio='none'%3E%3Cpath fill='%23db2777' fill-opacity='0.5' d='M 0,160 Q 200,280 400,160 T 800,160 L 800,320 L 0,320 Z'/%3E%3C/svg%3E")`,
        backgroundSize: '50% 100%',
        backgroundRepeat: 'repeat-x'
      }}
    />
  </div>
);

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [uiState, setUiState] = useState({ status: 'menu', score: 0, highScore: 0, difficulty: 'Harder' as Difficulty });
  const [audioInfo, setAudioInfo] = useState<{url: string, bpm: number} | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const state = useRef<GameState>({
    status: 'menu',
    score: 0,
    highScore: 0,
    player: {
      y: CANVAS_HEIGHT / 2,
      screenX: PLAYER_X,
      isHolding: false,
      trail: [],
      rotation: 0,
      size: 1,
      speedLevel: 1,
      isMini: false,
    },
    cameraX: 0,
    obstacles: [],
    particles: [],
    portals: [],
    gapCenter: CANVAS_HEIGHT / 2,
    trend: 0,
    trendLength: 0,
    nextPortalX: 3000,
    portalIndex: 0,
    generatedSpeedLevel: 1,
    generatedIsMini: false,
    difficulty: 'Harder',
    customPortalIndex: 0,
    botEnabled: false,
    lastY2: CANVAS_HEIGHT / 2,
    lastX2: 0,
    themeIndex: 0,
    themeTransition: 0,
    levelCompleteTimer: 0,
    gameoverTimer: 0,
  });

  const loadHardcodedAudio = async () => {
    setIsAnalyzing(true);
    try {
      const url = "https://storage.filebin.net/filebin/b67c1d8920a5c6cfce56b2a914ff8c11e3cc83c3d7fc5fe44c926ceb3e9ad763?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=GK352fd2505074fc9dde7fd2cb%2F20260312%2Fhel1-dc4%2Fs3%2Faws4_request&X-Amz-Date=20260312T140549Z&X-Amz-Expires=900&X-Amz-SignedHeaders=host&response-cache-control=max-age%3D900&response-content-disposition=inline%3B%20filename%3D%221266014_Tidal-WaveShiawase-VIP-rmx.mp3%22&response-content-type=audio%2Fmpeg&x-id=GetObject&X-Amz-Signature=72d9bf953ad4e6b8d5426732cfe8771d7e61e914c4ecc478657971eee39d3815";
      const response = await fetch(url);
      const blob = await response.blob();
      const file = new File([blob], "tidal_wave.mp3", { type: "audio/mp3" });
      
      const { beats, energyProfile, bpm } = await analyzeAudio(file);
      setAudioInfo({ url, bpm });
      
      const customPortals = generateCustomPortals(beats, energyProfile);
      state.current.customPortals = customPortals;
      state.current.customPortalIndex = 0;
      
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.load();
      }
    } catch (err) {
      console.error("Error analyzing audio", err);
      alert("Failed to analyze audio file.");
    }
    setIsAnalyzing(false);
  };

  useEffect(() => {
    loadHardcodedAudio();
  }, []);

  const generateMoreObstacles = useCallback(() => {
    const s = state.current;
    let startX = CANVAS_WIDTH;
    if (s.obstacles.length > 0) {
      const lastObs = s.obstacles[s.obstacles.length - 1];
      const diffProps = DIFFICULTY_PROPS[s.difficulty];
      const horizontalGap = diffProps.horizontalGapBase + Math.random() * diffProps.horizontalGapVar;
      startX = lastObs.x + lastObs.width + horizontalGap; 
    }

    for (let i = 0; i < 10; i++) {
      const diffProps = DIFFICULTY_PROPS[s.difficulty];
      const difficultyFactor = Math.min(1, (s.cameraX / 80000) * diffProps.shrinkRate);
      
      const baseGap = diffProps.baseGap;
      
      let steepness = s.generatedIsMini ? 1.732 : 1.0; // 60 degrees if mini, else 45 degrees
      let gapMultiplier = s.generatedIsMini ? 1.414 : 1.0;
      
      const currentGap = Math.max(diffProps.baseGap * 0.7, baseGap - difficultyFactor * 40) * gapMultiplier;

      const margin = 80;
      
      const maxDx = 250;
      const dx = (Math.random() * 2 - 1) * maxDx; // dx = topCenterX - botCenterX
      
      const maxPathYChange = Math.abs(dx) * steepness / 2;

      const minGapCenter = currentGap / 2 + margin + maxPathYChange;
      const maxGapCenter = CANVAS_HEIGHT - currentGap / 2 - margin - maxPathYChange;

      if (minGapCenter > maxGapCenter) {
        s.gapCenter = CANVAS_HEIGHT / 2;
      } else {
        s.gapCenter = minGapCenter + Math.random() * (maxGapCenter - minGapCenter);
      }
      
      const peakDistanceY = currentGap - Math.abs(dx) * steepness;
      
      const peakBotY = s.gapCenter + peakDistanceY / 2;
      const peakTopY = s.gapCenter - peakDistanceY / 2;
      
      const hBot = CANVAS_HEIGHT - peakBotY;
      const hTop = peakTopY;
      
      const halfWidthBot = hBot / steepness;
      const halfWidthTop = hTop / steepness;
      
      const minStartOffset = Math.min(-dx/2 - halfWidthBot, dx/2 - halfWidthTop);
      const centerX = startX - minStartOffset;
      
      const topCenterX = centerX + dx/2;
      const botCenterX = centerX - dx/2;
      
      const vy = 0; // Disabled moving slopes to prevent impossible passages
      
      s.obstacles.push({
        id: Math.random(),
        x: topCenterX - halfWidthTop,
        width: halfWidthTop * 2,
        isTop: true,
        points: [
          {x: 0, y: -1000},
          {x: 0, y: 0},
          {x: halfWidthTop, y: peakTopY},
          {x: halfWidthTop * 2, y: 0},
          {x: halfWidthTop * 2, y: -1000}
        ],
        hasSpikes: [false, Math.random() > 0.2, Math.random() > 0.2, false, false],
        vy,
        yOffset: 0
      });
      
      s.obstacles.push({
        id: Math.random(),
        x: botCenterX - halfWidthBot,
        width: halfWidthBot * 2,
        isTop: false,
        points: [
          {x: 0, y: CANVAS_HEIGHT + 1000},
          {x: 0, y: CANVAS_HEIGHT},
          {x: halfWidthBot, y: peakBotY},
          {x: halfWidthBot * 2, y: CANVAS_HEIGHT},
          {x: halfWidthBot * 2, y: CANVAS_HEIGHT + 1000}
        ],
        hasSpikes: [false, Math.random() > 0.2, Math.random() > 0.2, false, false],
        vy,
        yOffset: 0
      });

      // Portals
      const endOfGapX = Math.max(topCenterX, botCenterX) + 40;
      
      // Calculate the center of the gap at endOfGapX
      const getObsYAt = (isTop: boolean, peakX: number, peakY: number, x: number) => {
        const baseY = isTop ? 0 : CANVAS_HEIGHT;
        const dist = Math.abs(x - peakX);
        const y = peakY + (isTop ? -dist * steepness : dist * steepness);
        return isTop ? Math.max(baseY, y) : Math.min(baseY, y);
      };
      
      const topYAtEnd = getObsYAt(true, topCenterX, peakTopY, endOfGapX);
      const botYAtEnd = getObsYAt(false, botCenterX, peakBotY, endOfGapX);
      const portalY = (topYAtEnd + botYAtEnd) / 2;
      
      if (s.customPortals && s.customPortals.length > 0) {
        if (s.customPortalIndex < s.customPortals.length) {
          const nextPortal = s.customPortals[s.customPortalIndex];
          if (centerX >= nextPortal.x) {
            s.portals.push({
              id: nextPortal.x,
              x: endOfGapX, // Place at the end of the gap
              y: portalY,
              type: nextPortal.type,
              collected: false
            });
            if (nextPortal.type === 'mini') s.generatedIsMini = true;
            if (nextPortal.type === 'normal') s.generatedIsMini = false;
            s.customPortalIndex++;
          }
        }
      } else {
        if (centerX >= s.nextPortalX) {
          let type = PORTAL_SEQUENCE[s.portalIndex % PORTAL_SEQUENCE.length];
          
          let attempts = 0;
          while (attempts < PORTAL_SEQUENCE.length) {
            const isRedundant = 
              (type === 'speed_0' && s.generatedSpeedLevel === 0) ||
              (type === 'speed_1' && s.generatedSpeedLevel === 1) ||
              (type === 'speed_2' && s.generatedSpeedLevel === 2) ||
              (type === 'speed_3' && s.generatedSpeedLevel === 3) ||
              (type === 'speed_4' && s.generatedSpeedLevel === 4);
            
            if (!isRedundant) break;
            
            s.portalIndex++;
            attempts++;
            type = PORTAL_SEQUENCE[s.portalIndex % PORTAL_SEQUENCE.length];
          }

          s.portals.push({
            id: s.nextPortalX,
            x: endOfGapX, // Place at the end of the gap
            y: portalY,
            type: type,
            collected: false
          });
          if (type === 'speed_0') s.generatedSpeedLevel = 0;
          if (type === 'speed_1') s.generatedSpeedLevel = 1;
          if (type === 'speed_2') s.generatedSpeedLevel = 2;
          if (type === 'speed_3') s.generatedSpeedLevel = 3;
          if (type === 'speed_4') s.generatedSpeedLevel = 4;
          
          s.portalIndex++;
          s.nextPortalX = centerX + 6000 + Math.random() * 4000;
        }
      }

      const horizontalGap = diffProps.horizontalGapBase + Math.random() * diffProps.horizontalGapVar;
      startX = Math.max(topCenterX + halfWidthTop, botCenterX + halfWidthBot) + horizontalGap;
    }
  }, []);

  const startGame = useCallback(() => {
    if (!audioInfo?.url) return;
    
    state.current = {
      ...state.current,
      status: 'playing',
      score: 0,
      player: {
        y: CANVAS_HEIGHT / 2,
        screenX: PLAYER_X,
        isHolding: true,
        trail: [],
        rotation: -Math.PI / 4,
        size: 1,
        speedLevel: 1,
        isMini: false,
      },
      cameraX: 0,
      obstacles: [],
      particles: [],
      portals: [],
      gapCenter: CANVAS_HEIGHT / 2,
      trend: 0,
      trendLength: 0,
      nextPortalX: 8000,
      portalIndex: 0,
      generatedSpeedLevel: 1,
      generatedIsMini: false,
      difficulty: state.current.difficulty,
      customPortalIndex: 0,
      botEnabled: state.current.botEnabled,
      lastY2: CANVAS_HEIGHT / 2,
      lastX2: 0,
      themeIndex: 0,
      themeTransition: 0,
      levelCompleteTimer: 0,
      gameoverTimer: 0,
    };
    generateMoreObstacles();
    setUiState((prev) => ({ ...prev, status: 'playing', score: 0 }));

    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch(e => {
          if (e.name !== 'AbortError') {
            console.error("Audio play failed", e);
          }
        });
      }
    }
  }, [generateMoreObstacles, audioInfo?.url]);

  const levelComplete = useCallback(() => {
    const s = state.current;
    s.status = 'level_complete';
    s.levelCompleteTimer = 0;
    const finalScore = s.score;
    const newHighScore = Math.max(s.highScore, finalScore);
    s.highScore = newHighScore;
    setUiState(prev => ({ ...prev, status: 'level_complete', score: finalScore, highScore: newHighScore }));
  }, []);

  const die = useCallback(() => {
    const s = state.current;
    s.status = 'gameover';
    s.gameoverTimer = 2.0;
    const finalScore = s.score;
    const newHighScore = Math.max(s.highScore, finalScore);
    s.highScore = newHighScore;

    for (let i = 0; i < 50; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 400 + 100;
      s.particles.push({
        x: s.player.screenX + s.cameraX,
        y: s.player.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0 + Math.random() * 0.5,
        color: Math.random() > 0.5 ? '#00ffff' : '#ff0055',
      });
    }

    setUiState(prev => ({ ...prev, status: 'gameover', score: finalScore, highScore: newHighScore }));

    if (audioRef.current) {
      audioRef.current.pause();
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let lastTime = performance.now();

    const loop = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;
      const s = state.current;

      // Update
      if (s.status === 'playing') {
        if (audioRef.current && audioRef.current.ended) {
          levelComplete();
        } else {
          const currentSpeedX = s.player.speedLevel === 0 ? 350 : s.player.speedLevel === 1 ? 450 : s.player.speedLevel === 2 ? 580 : s.player.speedLevel === 3 ? 720 : 900;
          const currentSpeedY = currentSpeedX * (s.player.isMini ? 1.732 : 1);

          s.cameraX += currentSpeedX * dt;
        
        const targetThemeIndex = Math.floor(s.cameraX / 15000);
        if (targetThemeIndex > s.themeIndex) {
          s.themeIndex = targetThemeIndex;
          s.themeTransition = 1.0;
        }
        if (s.themeTransition > 0) {
          s.themeTransition = Math.max(0, s.themeTransition - dt * 1.5); // 0.66s transition
        }

        if (s.botEnabled) {
          const px = s.cameraX + s.player.screenX;
          const lookaheadX = px + currentSpeedX * 0.15; // Look ahead 0.15 seconds
          
          let currentTopY = 0;
          let currentBottomY = CANVAS_HEIGHT;
          let futureTopY = 0;
          let futureBottomY = CANVAS_HEIGHT;
          
          let foundCurrentTop = false;
          let foundCurrentBot = false;
          let foundFutureTop = false;
          let foundFutureBot = false;

          const getObsY = (obs: any, x: number) => {
            const halfWidth = obs.width / 2;
            const peakY = obs.isTop ? obs.points[2].y : CANVAS_HEIGHT - obs.points[2].y;
            const baseY = obs.isTop ? 0 : CANVAS_HEIGHT;
            const t = Math.max(0, 1 - Math.abs(x - (obs.x + halfWidth)) / halfWidth);
            return baseY + (peakY - baseY) * t + obs.yOffset;
          };

          for (const obs of s.obstacles) {
            if (obs.isTop) {
              if (!foundCurrentTop && px >= obs.x && px <= obs.x + obs.width) {
                currentTopY = getObsY(obs, px);
                foundCurrentTop = true;
              }
              if (!foundFutureTop && lookaheadX >= obs.x && lookaheadX <= obs.x + obs.width) {
                futureTopY = getObsY(obs, lookaheadX) + obs.vy * 0.15;
                foundFutureTop = true;
              }
            } else {
              if (!foundCurrentBot && px >= obs.x && px <= obs.x + obs.width) {
                currentBottomY = getObsY(obs, px);
                foundCurrentBot = true;
              }
              if (!foundFutureBot && lookaheadX >= obs.x && lookaheadX <= obs.x + obs.width) {
                futureBottomY = getObsY(obs, lookaheadX) + obs.vy * 0.15;
                foundFutureBot = true;
              }
            }
          }
          
          if (!foundFutureTop) futureTopY = 0;
          if (!foundFutureBot) futureBottomY = CANVAS_HEIGHT;
          
          let targetY = (futureTopY + futureBottomY) / 2;
          let gapAtX = futureBottomY - futureTopY;
          
          for (const p of s.portals) {
            if (!p.collected && p.x > px && p.x < px + currentSpeedX * 0.3) {
              targetY = p.y;
              break;
            }
          }
          
          const playerSize = 6 * s.player.size * (s.player.isMini ? 0.5 : 1.0);
          const emergencyMargin = playerSize + currentSpeedY * 0.03;
          const topBound = foundCurrentTop ? currentTopY : 0;
          const bottomBound = foundCurrentBot ? currentBottomY : CANVAS_HEIGHT;
          
          if (s.player.y < topBound + emergencyMargin) {
            s.player.isHolding = false; // Go down
          } else if (s.player.y > bottomBound - emergencyMargin) {
            s.player.isHolding = true; // Go up
          } else {
            const safeMargin = gapAtX * 0.3;
            if (s.player.y > targetY + safeMargin) {
              s.player.isHolding = true;
            } else if (s.player.y < targetY - safeMargin) {
              s.player.isHolding = false;
            }
          }
        }

        if (s.player.isHolding) {
          s.player.y -= currentSpeedY * dt;
        } else {
          s.player.y += currentSpeedY * dt;
        }

        const newScore = Math.floor(s.cameraX / 100);
        if (newScore > s.score) {
          s.score = newScore;
          if (newScore % 5 === 0) {
            setUiState((prev) => ({ ...prev, score: newScore }));
          }
        }

        s.player.trail.push({ x: s.cameraX + s.player.screenX, y: s.player.y });
        while (s.player.trail.length > 0 && s.player.trail[0].x - s.cameraX < -150) {
          s.player.trail.shift();
        }

        const lastObs = s.obstacles[s.obstacles.length - 1];
        if (lastObs && lastObs.x - s.cameraX < CANVAS_WIDTH * 2) {
          generateMoreObstacles();
        }

        while (s.obstacles.length > 0 && s.obstacles[0].x + s.obstacles[0].width - s.cameraX < -200) {
          s.obstacles.shift();
        }

        // Portals update & collision
        const px = s.cameraX + s.player.screenX;
        const prevPx = px - currentSpeedX * dt;

        for (let i = s.portals.length - 1; i >= 0; i--) {
          const portal = s.portals[i];
          if (portal.x - s.cameraX < -100) {
            s.portals.splice(i, 1);
            continue;
          }

          const crossedX = (prevPx <= portal.x && px >= portal.x) || Math.abs(px - portal.x) < 30;

          if (!portal.collected && crossedX && Math.abs(s.player.y - portal.y) < 100) {
            portal.collected = true;
            if (portal.type === 'speed_0') s.player.speedLevel = 0;
            if (portal.type === 'speed_1') s.player.speedLevel = 1;
            if (portal.type === 'speed_2') s.player.speedLevel = 2;
            if (portal.type === 'speed_3') s.player.speedLevel = 3;
            if (portal.type === 'speed_4') s.player.speedLevel = 4;
            if (portal.type === 'mini') s.player.isMini = true;
            if (portal.type === 'normal') s.player.isMini = false;
          }
        }

        const py = s.player.y;
        const size = 6 * (s.player.isMini ? 0.5 : 1.0);

        for (const obs of s.obstacles) {
          if (obs.vy !== 0) {
            obs.yOffset += obs.vy * dt;
            if (obs.yOffset > 80) {
              obs.yOffset = 80;
              obs.vy *= -1;
            } else if (obs.yOffset < -80) {
              obs.yOffset = -80;
              obs.vy *= -1;
            }
          }
        }

        const checkCollision = () => {
          if (py < 0 || py > CANVAS_HEIGHT) return true;
          
          for (const obs of s.obstacles) {
            if (px + size < obs.x || px - size > obs.x + obs.width) continue;
            
            for (let i = 0; i < obs.points.length - 1; i++) {
              const p1 = obs.points[i];
              const p2 = obs.points[i+1];
              const absX1 = obs.x + p1.x;
              const absX2 = obs.x + p2.x;
              const p1y = p1.y + obs.yOffset;
              const p2y = p2.y + obs.yOffset;
              
              if (distToSegment(px, py, absX1, p1y, absX2, p2y) < size) return true;
              
              if (absX1 !== absX2 && px >= Math.min(absX1, absX2) && px <= Math.max(absX1, absX2)) {
                const t = (px - absX1) / (absX2 - absX1);
                const segY = p1y + t * (p2y - p1y);
                if (obs.isTop && py < segY) return true;
                if (!obs.isTop && py > segY) return true;
              }
            }
            
            for (let i = 0; i < obs.points.length - 1; i++) {
              if (!obs.hasSpikes[i]) continue;
              const p1 = obs.points[i];
              const p2 = obs.points[i+1];
              const absX1 = obs.x + p1.x;
              const absX2 = obs.x + p2.x;
              const p1y = p1.y + obs.yOffset;
              const p2y = p2.y + obs.yOffset;
              
              const dx = absX2 - absX1;
              const dy = p2y - p1y;
              const len = Math.hypot(dx, dy);
              if (len === 0) continue;
              
              const tx = dx / len;
              const ty = dy / len;
              const nx = obs.isTop ? -ty : ty;
              const ny = obs.isTop ? tx : -tx;
              
              const numSpikes = Math.floor(len / 40);
              const spikeW = 12;
              const spikeH = 20;
              
              for (let j = 1; j < numSpikes; j++) {
                const t = j / numSpikes;
                const sx = absX1 + dx * t;
                const sy = p1y + dy * t;
                
                const tipX = sx + nx * spikeH;
                const tipY = sy + ny * spikeH;
                const base1X = sx - tx * spikeW;
                const base1Y = sy - ty * spikeW;
                const base2X = sx + tx * spikeW;
                const base2Y = sy + ty * spikeW;
                
                if (distToSegment(px, py, base1X, base1Y, tipX, tipY) < size) return true;
                if (distToSegment(px, py, base2X, base2Y, tipX, tipY) < size) return true;
              }
            }
          }
          return false;
        };

        if (checkCollision()) {
          die();
        }

        if (py < 0 || py > CANVAS_HEIGHT) {
          die();
        }
        }
      } else if (s.status === 'level_complete') {
        s.levelCompleteTimer += dt;
        
        // Dramatic suck effect
        const suckProgress = Math.min(1, s.levelCompleteTimer / 0.3);
        const easeInCubic = suckProgress * suckProgress * suckProgress;
        
        s.player.rotation += dt * (15 + easeInCubic * 50); // Spin faster and faster
        s.player.size = Math.max(0, 1 - easeInCubic); // Shrink to 0
        
        // Move towards center
        const targetX = CANVAS_WIDTH / 2;
        const targetY = CANVAS_HEIGHT / 2;
        
        s.cameraX += 310 * dt * Math.max(0, 1 - easeInCubic);
        
        // Move y and screenX towards center
        s.player.y += (targetY - s.player.y) * dt * (10 + easeInCubic * 20);
        s.player.screenX += (targetX - s.player.screenX) * dt * (10 + easeInCubic * 20);
        
        // Add particles sucking in
        for (let i = 0; i < 10; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 200 + Math.random() * 300;
          s.particles.push({
            x: s.player.screenX + s.cameraX + Math.cos(angle) * dist,
            y: s.player.y + Math.sin(angle) * dist,
            vx: -Math.cos(angle) * (800 + easeInCubic * 1200),
            vy: -Math.sin(angle) * (800 + easeInCubic * 1200),
            life: 0.3,
            color: Math.random() > 0.5 ? '#00ffff' : '#ffffff',
          });
        }
        
        for (let i = s.particles.length - 1; i >= 0; i--) {
          const p = s.particles[i];
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.life -= dt * 2;
          if (p.life <= 0) {
            s.particles.splice(i, 1);
          }
        }
      } else if (s.status === 'gameover') {
        s.gameoverTimer -= dt;
        if (s.gameoverTimer <= 0 && s.gameoverTimer > -10) {
          s.gameoverTimer = -100; // prevent multiple calls
          startGame();
        }
        for (let i = s.particles.length - 1; i >= 0; i--) {
          const p = s.particles[i];
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.life -= dt * 2;
          if (p.life <= 0) {
            s.particles.splice(i, 1);
          }
        }
      }

      // Draw
      const diffProps = DIFFICULTY_PROPS[s.difficulty];
      const hueShift = diffProps.hue !== undefined ? (diffProps.hue - 210) * 0.15 : 0;
      
      const theme = interpolateTheme(s.themeIndex, s.themeTransition);
      theme.bgTop[0] += hueShift;
      theme.bgBottom[0] += hueShift;
      theme.structBase[0] += hueShift;
      theme.structGlow[0] += hueShift;
      theme.spikeColor[0] += hueShift;

      const pulse = Math.sin(time / 200) * 0.5 + 0.5;

      // Sky and Ocean Gradient
      const bgGradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
      bgGradient.addColorStop(0, `hsl(${theme.bgTop[0]}, ${theme.bgTop[1]}%, ${theme.bgTop[2] + pulse * 5}%)`);
      bgGradient.addColorStop(1, `hsl(${theme.bgBottom[0]}, ${theme.bgBottom[1]}%, ${theme.bgBottom[2]}%)`);
      ctx.fillStyle = bgGradient;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      
      // Flash effect during transition
      if (s.themeTransition > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${s.themeTransition * 0.5})`;
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      }

      // Background details
      const drawSurface = (alpha: number) => {
        if (alpha <= 0) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        
        const horizonY = CANVAS_HEIGHT * 0.45;
        
        // Sky gradient
        const skyGradient = ctx.createLinearGradient(0, 0, 0, horizonY);
        skyGradient.addColorStop(0, '#7dd3fc'); // sky-300
        skyGradient.addColorStop(1, '#cffafe'); // cyan-100
        ctx.fillStyle = skyGradient;
        ctx.fillRect(0, 0, CANVAS_WIDTH, horizonY);

        // Suns / Glowing orbs
        const drawSun = (x: number, y: number, radius: number, color: string) => {
          const rx = (x - (s.cameraX * 0.05)) % (CANVAS_WIDTH + 400);
          const drawX = rx < -200 ? rx + CANVAS_WIDTH + 400 : rx;
          
          const grad = ctx.createRadialGradient(drawX, y, 0, drawX, y, radius);
          grad.addColorStop(0, color);
          grad.addColorStop(0.4, color.replace('1)', '0.8)'));
          grad.addColorStop(1, color.replace('1)', '0)'));
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(drawX, y, radius, 0, Math.PI * 2);
          ctx.fill();
        };
        
        drawSun(300, 150, 150, 'rgba(253, 224, 71, 1)'); // yellow
        drawSun(900, 100, 200, 'rgba(255, 255, 255, 1)'); // white
        drawSun(1500, 200, 120, 'rgba(253, 224, 71, 1)'); // yellow

        // Clouds
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        const drawCloud = (x: number, y: number, scale: number) => {
          const rx = (x - (s.cameraX * 0.1)) % (CANVAS_WIDTH + 600);
          const drawX = rx < -300 ? rx + CANVAS_WIDTH + 600 : rx;
          
          ctx.beginPath();
          ctx.arc(drawX, y, 60 * scale, 0, Math.PI * 2);
          ctx.arc(drawX + 50 * scale, y - 30 * scale, 70 * scale, 0, Math.PI * 2);
          ctx.arc(drawX + 100 * scale, y, 50 * scale, 0, Math.PI * 2);
          ctx.fill();
        };
        
        drawCloud(200, 200, 1);
        drawCloud(700, 150, 1.5);
        drawCloud(1200, 250, 0.8);
        drawCloud(1800, 180, 1.2);

        // Ocean gradient
        const oceanGradient = ctx.createLinearGradient(0, horizonY, 0, CANVAS_HEIGHT);
        oceanGradient.addColorStop(0, '#22d3ee'); // cyan-400
        oceanGradient.addColorStop(1, '#0284c7'); // sky-600
        ctx.fillStyle = oceanGradient;
        ctx.fillRect(0, horizonY, CANVAS_WIDTH, CANVAS_HEIGHT - horizonY);

        // Horizon glow
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.fillRect(0, horizonY - 2, CANVAS_WIDTH, 4);
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#ffffff';
        ctx.fillRect(0, horizonY - 1, CANVAS_WIDTH, 2);
        ctx.shadowBlur = 0;

        // Ocean waves (horizontal dashes)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        const waveSpacingX = 150;
        const waveSpacingY = 40;
        const wOffsetX = -((s.cameraX * 0.15) % waveSpacingX);
        for (let y = horizonY + 20; y < CANVAS_HEIGHT; y += waveSpacingY) {
          const rowOffset = (y % 80 === 0) ? waveSpacingX / 2 : 0;
          for (let x = wOffsetX - waveSpacingX; x < CANVAS_WIDTH + waveSpacingX; x += waveSpacingX) {
            ctx.moveTo(x + rowOffset, y);
            ctx.lineTo(x + rowOffset + 30, y);
          }
        }
        ctx.stroke();

        // Background Triangles
        const drawBgTriangle = (x: number, y: number, size: number) => {
          const rx = (x - (s.cameraX * 0.25)) % (CANVAS_WIDTH + 800);
          const drawX = rx < -400 ? rx + CANVAS_WIDTH + 800 : rx;
          
          ctx.fillStyle = 'rgba(14, 165, 233, 0.4)'; // sky-500 with opacity
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)'; // sky-400
          ctx.lineWidth = 2;
          
          ctx.beginPath();
          ctx.moveTo(drawX, y - size);
          ctx.lineTo(drawX + size, y + size);
          ctx.lineTo(drawX - size, y + size);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          
          // Inner lines
          ctx.beginPath();
          ctx.moveTo(drawX, y - size);
          ctx.lineTo(drawX, y + size);
          ctx.moveTo(drawX - size/2, y);
          ctx.lineTo(drawX + size/2, y);
          ctx.stroke();
        };

        drawBgTriangle(200, CANVAS_HEIGHT - 100, 150);
        drawBgTriangle(600, CANVAS_HEIGHT - 50, 200);
        drawBgTriangle(1100, CANVAS_HEIGHT - 150, 120);
        drawBgTriangle(1600, CANVAS_HEIGHT - 80, 180);

        // Foreground bubbly water
        const fgWaveSpacing = 300;
        const fgOffsetX = -((s.cameraX * 0.4) % fgWaveSpacing);
        
        ctx.fillStyle = 'rgba(125, 211, 252, 0.9)'; // sky-300
        ctx.beginPath();
        ctx.moveTo(0, CANVAS_HEIGHT);
        for (let x = fgOffsetX - fgWaveSpacing; x < CANVAS_WIDTH + fgWaveSpacing; x += fgWaveSpacing) {
          ctx.lineTo(x, CANVAS_HEIGHT - 60);
          ctx.quadraticCurveTo(x + fgWaveSpacing/4, CANVAS_HEIGHT - 100, x + fgWaveSpacing/2, CANVAS_HEIGHT - 60);
          ctx.quadraticCurveTo(x + fgWaveSpacing*0.75, CANVAS_HEIGHT - 20, x + fgWaveSpacing, CANVAS_HEIGHT - 60);
        }
        ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.fill();
        
        // Bubbles in foreground water
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        for (let i = 0; i < 20; i++) {
          const bx = (i * 137 - (s.cameraX * 0.4)) % CANVAS_WIDTH;
          const drawBx = bx < 0 ? bx + CANVAS_WIDTH : bx;
          const by = CANVAS_HEIGHT - 30 + Math.sin(time * 0.002 + i) * 20;
          ctx.beginPath();
          ctx.arc(drawBx, by, 10 + (i % 15), 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      };

      const drawUnderwater = (alpha: number) => {
        if (alpha <= 0) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        
        // Deep water gradient
        const bgGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
        bgGrad.addColorStop(0, `hsla(190, 100%, 15%, 0.6)`);
        bgGrad.addColorStop(1, `hsla(200, 100%, 5%, 0.8)`);
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Light rays
        ctx.fillStyle = `hsla(180, 100%, 70%, 0.08)`;
        ctx.beginPath();
        ctx.moveTo(CANVAS_WIDTH * 0.2, 0);
        ctx.lineTo(CANVAS_WIDTH * 0.3, 0);
        ctx.lineTo(CANVAS_WIDTH * 0.6, CANVAS_HEIGHT);
        ctx.lineTo(CANVAS_WIDTH * 0.4, CANVAS_HEIGHT);
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(CANVAS_WIDTH * 0.7, 0);
        ctx.lineTo(CANVAS_WIDTH * 0.9, 0);
        ctx.lineTo(CANVAS_WIDTH * 1.1, CANVAS_HEIGHT);
        ctx.lineTo(CANVAS_WIDTH * 0.8, CANVAS_HEIGHT);
        ctx.fill();

        // Coral silhouettes in background
        ctx.fillStyle = `hsla(190, 100%, 10%, 0.5)`;
        for(let i = 0; i < 5; i++) {
          const cx = (i * 400 - (s.cameraX * 0.05)) % (CANVAS_WIDTH + 400);
          const drawX = cx < -200 ? cx + CANVAS_WIDTH + 400 : cx;
          ctx.beginPath();
          ctx.moveTo(drawX, CANVAS_HEIGHT);
          ctx.quadraticCurveTo(drawX - 50, CANVAS_HEIGHT - 150, drawX + 20, CANVAS_HEIGHT - 250);
          ctx.quadraticCurveTo(drawX + 80, CANVAS_HEIGHT - 100, drawX + 100, CANVAS_HEIGHT);
          ctx.fill();
        }

        // Proper Bubbles Animation
        const bubSpacing = 150;
        const ySpacing = 120;
        const startCol = Math.floor((s.cameraX * 0.2) / bubSpacing) - 1;
        const endCol = startCol + Math.ceil(CANVAS_WIDTH / bubSpacing) + 2;
        
        for (let col = startCol; col <= endCol; col++) {
          for (let row = 0; row < Math.ceil(CANVAS_HEIGHT / ySpacing) + 2; row++) {
            const hash = Math.sin(col * 13.37 + row * 42.1) * 1000;
            const speed = 0.05 * (Math.abs(hash) % 3 + 1);
            
            // Base Y position wraps around
            const wrapHeight = CANVAS_HEIGHT + 200;
            const offsetY = Math.abs(hash) % ySpacing;
            const absoluteY = (row * ySpacing + offsetY - time * speed);
            const bubY = ((absoluteY % wrapHeight) + wrapHeight) % wrapHeight - 100;
            
            // Base X position
            const offsetX = Math.abs(hash * 2.3) % bubSpacing;
            const baseX = col * bubSpacing + offsetX;
            const driftX = Math.sin(time * 0.002 + hash) * 40;
            const bubX = baseX + driftX - (s.cameraX * 0.2);
            
            const r = 4 + Math.abs(hash % 12);
            
            // Wobble effect
            const wobbleX = Math.sin(time * 0.01 + hash) * (r * 0.2);
            const wobbleY = Math.cos(time * 0.01 + hash) * (r * 0.2);

            ctx.beginPath();
            ctx.ellipse(bubX, bubY, r + Math.abs(wobbleX), r + Math.abs(wobbleY), 0, 0, Math.PI * 2);
            
            // Gradient bubble
            const grad = ctx.createRadialGradient(bubX - r*0.3, bubY - r*0.3, r*0.1, bubX, bubY, r);
            grad.addColorStop(0, `hsla(180, 100%, 100%, 0.8)`);
            grad.addColorStop(0.4, `hsla(180, 100%, 80%, 0.2)`);
            grad.addColorStop(1, `hsla(180, 100%, 60%, 0.5)`);
            
            ctx.fillStyle = grad;
            ctx.fill();
            
            ctx.strokeStyle = `hsla(180, 100%, 90%, 0.6)`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            
            // Reflection highlight
            ctx.beginPath();
            ctx.arc(bubX - r * 0.3, bubY - r * 0.3, r * 0.2, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, 0.6)`;
            ctx.fill();
          }
        }
        ctx.restore();
      };

      const drawDeepOcean = (alpha: number) => {
        if (alpha <= 0) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        
        // Deep ocean gradient
        const deepGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
        deepGrad.addColorStop(0, `hsla(220, 100%, 10%, 0.7)`);
        deepGrad.addColorStop(1, `hsla(220, 100%, 2%, 0.9)`);
        ctx.fillStyle = deepGrad;
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Giant glowing crystals in background
        for (let i = 0; i < 4; i++) {
          const cx = (i * 600 - (s.cameraX * 0.03)) % (CANVAS_WIDTH + 600);
          const drawX = cx < -300 ? cx + CANVAS_WIDTH + 600 : cx;
          const height = 300 + (i % 3) * 100;
          
          const grad = ctx.createLinearGradient(drawX, CANVAS_HEIGHT, drawX, CANVAS_HEIGHT - height);
          grad.addColorStop(0, `hsla(280, 100%, 50%, 0.4)`);
          grad.addColorStop(1, `hsla(280, 100%, 50%, 0)`);
          
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(drawX - 50, CANVAS_HEIGHT);
          ctx.lineTo(drawX, CANVAS_HEIGHT - height);
          ctx.lineTo(drawX + 50, CANVAS_HEIGHT);
          ctx.fill();
        }

        // Bioluminescent jellyfish / particles
        ctx.fillStyle = `hsla(280, 100%, 70%, 0.6)`;
        ctx.shadowBlur = 25;
        ctx.shadowColor = `hsla(280, 100%, 70%, 1)`;
        const jellySpacing = 300;
        const ySpacing = 200;
        const startCol = Math.floor((s.cameraX * 0.1) / jellySpacing) - 1;
        const endCol = startCol + Math.ceil(CANVAS_WIDTH / jellySpacing) + 2;
        
        for (let col = startCol; col <= endCol; col++) {
          for (let row = 0; row < Math.ceil(CANVAS_HEIGHT / ySpacing) + 2; row++) {
            const hash = Math.sin(col * 3.3 + row * 5.5) * 1000;
            const speed = 0.02 * (Math.abs(hash) % 2 + 1);
            
            const wrapHeight = CANVAS_HEIGHT + 200;
            const offsetY = Math.abs(hash) % ySpacing;
            const absoluteY = (row * ySpacing + offsetY - time * speed);
            const jY = ((absoluteY % wrapHeight) + wrapHeight) % wrapHeight - 100 + Math.sin(time * 0.001 + hash) * 50;
            
            const offsetX = Math.abs(hash * 1.7) % jellySpacing;
            const baseX = col * jellySpacing + offsetX;
            const jX = baseX - (s.cameraX * 0.1) + Math.cos(time * 0.001 + hash) * 20;

            // Jellyfish body
            ctx.beginPath();
            ctx.ellipse(jX, jY, 18, 12, 0, Math.PI, Math.PI * 2);
            ctx.fill();
            
            // Inner glow
            ctx.fillStyle = `hsla(280, 100%, 90%, 0.8)`;
            ctx.beginPath();
            ctx.ellipse(jX, jY - 2, 8, 5, 0, Math.PI, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = `hsla(280, 100%, 70%, 0.6)`;

            // Tentacles
            ctx.beginPath();
            ctx.moveTo(jX - 12, jY);
            ctx.quadraticCurveTo(jX - 18, jY + 30, jX - 8, jY + 45);
            ctx.moveTo(jX - 4, jY);
            ctx.quadraticCurveTo(jX - 4, jY + 35, jX + 2, jY + 50);
            ctx.moveTo(jX + 4, jY);
            ctx.quadraticCurveTo(jX + 4, jY + 35, jX + 10, jY + 45);
            ctx.moveTo(jX + 12, jY);
            ctx.quadraticCurveTo(jX + 18, jY + 30, jX + 18, jY + 40);
            ctx.strokeStyle = `hsla(280, 100%, 70%, 0.5)`;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
        ctx.restore();
      };

      const drawAbyss = (alpha: number) => {
        if (alpha <= 0) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        
        // Deep darkness gradient
        const abyssGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
        abyssGrad.addColorStop(0, `hsla(240, 100%, 5%, 0.8)`);
        abyssGrad.addColorStop(1, `hsla(240, 100%, 2%, 0.9)`);
        ctx.fillStyle = abyssGrad;
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Dark tendrils in background
        ctx.strokeStyle = `hsla(260, 100%, 15%, 0.4)`;
        ctx.lineWidth = 15;
        ctx.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          const cx = (i * 300 - (s.cameraX * 0.04)) % (CANVAS_WIDTH + 300);
          const drawX = cx < -150 ? cx + CANVAS_WIDTH + 300 : cx;
          ctx.beginPath();
          ctx.moveTo(drawX, 0);
          ctx.bezierCurveTo(
            drawX + Math.sin(time * 0.001 + i) * 100, CANVAS_HEIGHT * 0.3,
            drawX - Math.sin(time * 0.001 + i) * 100, CANVAS_HEIGHT * 0.6,
            drawX + Math.sin(time * 0.002 + i) * 150, CANVAS_HEIGHT
          );
          ctx.stroke();
        }

        // Creepy glowing eyes in the dark
        const eyeSpacing = 400;
        const eOffsetX = -((s.cameraX * 0.08) % eyeSpacing);
        for (let x = eOffsetX - 200; x < CANVAS_WIDTH + 200; x += eyeSpacing) {
          for (let y = 100; y < CANVAS_HEIGHT; y += 250) {
            const hash = Math.sin(x * 1.2 + y * 3.4) * 1000;
            if (hash % 10 > 4) continue; // Only spawn sometimes
            
            const blink = Math.sin(time * 0.002 + hash) > 0.95 ? 0.1 : 1;
            const eyeY = y + Math.sin(time * 0.001 + hash) * 30;
            const eyeX = x + Math.cos(time * 0.001 + hash) * 30;
            
            const eyeColor = hash % 2 > 1 ? `hsla(0, 100%, 50%, ${0.8 * blink})` : `hsla(280, 100%, 60%, ${0.8 * blink})`;
            
            ctx.fillStyle = eyeColor;
            ctx.shadowBlur = 30;
            ctx.shadowColor = eyeColor;
            
            // Left eye
            ctx.beginPath();
            ctx.ellipse(eyeX - 25, eyeY, 12, 4 * blink, Math.sin(time*0.001)*0.2, 0, Math.PI * 2);
            ctx.fill();
            
            // Right eye
            ctx.beginPath();
            ctx.ellipse(eyeX + 25, eyeY, 12, 4 * blink, -Math.sin(time*0.001)*0.2, 0, Math.PI * 2);
            ctx.fill();
            
            // Pupils
            if (blink > 0.5) {
              ctx.fillStyle = '#000';
              ctx.shadowBlur = 0;
              ctx.beginPath();
              ctx.arc(eyeX - 25, eyeY, 3, 0, Math.PI * 2);
              ctx.arc(eyeX + 25, eyeY, 3, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        ctx.restore();
      };

      const drawLava = (alpha: number) => {
        if (alpha <= 0) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        
        // Heat distortion / Lava glow
        const lavaGrad = ctx.createLinearGradient(0, CANVAS_HEIGHT, 0, 0);
        lavaGrad.addColorStop(0, `hsla(10, 100%, 40%, 0.7)`);
        lavaGrad.addColorStop(0.5, `hsla(10, 100%, 20%, 0.4)`);
        lavaGrad.addColorStop(1, `hsla(10, 100%, 10%, 0.8)`);
        ctx.fillStyle = lavaGrad;
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Erupting Volcanoes in background
        ctx.fillStyle = `hsla(0, 100%, 10%, 0.8)`;
        for(let i = 0; i < 3; i++) {
          const cx = (i * 800 - (s.cameraX * 0.05)) % (CANVAS_WIDTH + 800);
          const drawX = cx < -400 ? cx + CANVAS_WIDTH + 800 : cx;
          
          ctx.beginPath();
          ctx.moveTo(drawX - 300, CANVAS_HEIGHT);
          ctx.lineTo(drawX - 50, CANVAS_HEIGHT - 400);
          ctx.lineTo(drawX + 50, CANVAS_HEIGHT - 400);
          ctx.lineTo(drawX + 300, CANVAS_HEIGHT);
          ctx.fill();
          
          // Lava spilling
          ctx.fillStyle = `hsla(15, 100%, 50%, 0.6)`;
          ctx.shadowBlur = 30;
          ctx.shadowColor = '#ff4400';
          ctx.beginPath();
          ctx.moveTo(drawX - 40, CANVAS_HEIGHT - 400);
          ctx.lineTo(drawX + 40, CANVAS_HEIGHT - 400);
          ctx.lineTo(drawX + 100, CANVAS_HEIGHT - 200);
          ctx.lineTo(drawX - 20, CANVAS_HEIGHT - 100);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = `hsla(0, 100%, 10%, 0.8)`; // reset
        }

        // Rising embers
        const emberSpacing = 100;
        const eOffsetX = -((s.cameraX * 0.15) % emberSpacing);
        for (let x = eOffsetX - 100; x < CANVAS_WIDTH + 100; x += emberSpacing) {
          for (let y = 0; y < CANVAS_HEIGHT; y += 120) {
            const hash = Math.sin(x * 5.5 + y * 9.9) * 1000;
            const speed = 0.15 * (Math.abs(hash) % 3 + 1);
            const emberY = (y - time * speed + CANVAS_HEIGHT * 2) % CANVAS_HEIGHT;
            const emberX = x + Math.sin(time * 0.005 + hash) * 50;
            const r = 3 + Math.abs(hash % 5);
            
            ctx.fillStyle = `hsla(${10 + (hash%30)}, 100%, 60%, ${0.6 + Math.sin(time * 0.01 + hash) * 0.4})`;
            ctx.shadowBlur = 20;
            ctx.shadowColor = `hsla(${10 + (hash%30)}, 100%, 50%, 1)`;
            
            ctx.beginPath();
            ctx.arc(emberX, emberY, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
          }
        }
        ctx.restore();
      };

      const drawNeon = (alpha: number) => {
        if (alpha <= 0) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        
        // Dark background
        ctx.fillStyle = `hsla(280, 100%, 5%, 0.8)`;
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Moving grid
        ctx.strokeStyle = `hsla(300, 100%, 50%, 0.3)`;
        ctx.lineWidth = 2;
        const gridSpacing = 100;
        const gOffsetX = -((s.cameraX * 0.2) % gridSpacing);
        const gOffsetY = (time * 0.05) % gridSpacing;
        
        ctx.beginPath();
        for (let x = gOffsetX; x < CANVAS_WIDTH; x += gridSpacing) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, CANVAS_HEIGHT);
        }
        for (let y = gOffsetY; y < CANVAS_HEIGHT; y += gridSpacing) {
          ctx.moveTo(0, y);
          ctx.lineTo(CANVAS_WIDTH, y);
        }
        ctx.stroke();
        
        // Floating geometric shapes
        const shapeSpacing = 300;
        const sOffsetX = -((s.cameraX * 0.1) % shapeSpacing);
        for (let x = sOffsetX - 150; x < CANVAS_WIDTH + 150; x += shapeSpacing) {
          for (let y = 100; y < CANVAS_HEIGHT; y += 250) {
            const hash = Math.sin(x * 2.2 + y * 4.4) * 1000;
            const shapeY = y + Math.sin(time * 0.002 + hash) * 50;
            const shapeX = x + Math.cos(time * 0.002 + hash) * 30;
            const rot = time * 0.001 * (hash % 2 > 0 ? 1 : -1);
            
            ctx.save();
            ctx.translate(shapeX, shapeY);
            ctx.rotate(rot);
            ctx.strokeStyle = `hsla(${300 + (hash%60)}, 100%, 60%, 0.5)`;
            ctx.lineWidth = 3;
            ctx.shadowBlur = 20;
            ctx.shadowColor = `hsla(${300 + (hash%60)}, 100%, 60%, 0.8)`;
            
            ctx.beginPath();
            if (Math.abs(hash) % 3 < 1) {
              ctx.rect(-20, -20, 40, 40);
            } else if (Math.abs(hash) % 3 < 2) {
              ctx.moveTo(0, -25);
              ctx.lineTo(25, 20);
              ctx.lineTo(-25, 20);
              ctx.closePath();
            } else {
              ctx.arc(0, 0, 20, 0, Math.PI * 2);
            }
            ctx.stroke();
            
            // Inner filled shape
            ctx.fillStyle = `hsla(${300 + (hash%60)}, 100%, 60%, 0.1)`;
            ctx.fill();
            ctx.restore();
          }
        }
        ctx.restore();
      };

      const drawToxic = (alpha: number) => {
        if (alpha <= 0) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        
        // Toxic fog
        const fogGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
        fogGrad.addColorStop(0, `hsla(120, 100%, 20%, 0.3)`);
        fogGrad.addColorStop(1, `hsla(120, 100%, 10%, 0.8)`);
        ctx.fillStyle = fogGrad;
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Rusty pipes in background
        ctx.fillStyle = `hsla(30, 50%, 10%, 0.6)`;
        for(let i = 0; i < 4; i++) {
          const cx = (i * 500 - (s.cameraX * 0.06)) % (CANVAS_WIDTH + 500);
          const drawX = cx < -250 ? cx + CANVAS_WIDTH + 500 : cx;
          
          ctx.fillRect(drawX, 0, 80, CANVAS_HEIGHT);
          
          // Pipe details
          ctx.fillStyle = `hsla(30, 50%, 5%, 0.8)`;
          ctx.fillRect(drawX - 10, CANVAS_HEIGHT * 0.3, 100, 40);
          ctx.fillRect(drawX - 10, CANVAS_HEIGHT * 0.7, 100, 40);
          ctx.fillStyle = `hsla(30, 50%, 10%, 0.6)`;
        }

        const bubbleSpacing = 150;
        const bOffsetX = -((s.cameraX * 0.1) % bubbleSpacing);
        for (let x = bOffsetX - 100; x < CANVAS_WIDTH + 100; x += bubbleSpacing) {
          for (let y = 0; y < CANVAS_HEIGHT; y += 150) {
            const hash = Math.sin(x * 11.1 + y * 33.3) * 1000;
            const speed = 0.08 * (Math.abs(hash) % 3 + 1);
            const bubY = (CANVAS_HEIGHT + (time * speed + hash * 100)) % CANVAS_HEIGHT;
            const bubX = x + Math.sin(time * 0.003 + hash) * 50;
            const r = 8 + Math.abs(hash % 15);
            
            const wobbleX = Math.sin(time * 0.015 + hash) * (r * 0.3);
            const wobbleY = Math.cos(time * 0.015 + hash) * (r * 0.3);

            ctx.beginPath();
            ctx.ellipse(bubX, bubY, r + wobbleX, r + wobbleY, 0, 0, Math.PI * 2);
            
            const grad = ctx.createRadialGradient(bubX - r*0.2, bubY - r*0.2, r*0.1, bubX, bubY, r);
            grad.addColorStop(0, `hsla(120, 100%, 80%, 0.9)`);
            grad.addColorStop(0.5, `hsla(120, 100%, 50%, 0.6)`);
            grad.addColorStop(1, `hsla(120, 100%, 30%, 0.2)`);
            
            ctx.fillStyle = grad;
            ctx.fill();
            
            // Toxic glow
            ctx.shadowBlur = 25;
            ctx.shadowColor = `hsla(120, 100%, 50%, 1)`;
            ctx.fill();
            ctx.shadowBlur = 0;
          }
        }
        ctx.restore();
      };

      const drawBlood = (alpha: number) => {
        if (alpha <= 0) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        
        // Red vignette
        const vigGrad = ctx.createRadialGradient(CANVAS_WIDTH/2, CANVAS_HEIGHT/2, CANVAS_HEIGHT*0.2, CANVAS_WIDTH/2, CANVAS_HEIGHT/2, CANVAS_HEIGHT);
        vigGrad.addColorStop(0, `hsla(0, 100%, 20%, 0)`);
        vigGrad.addColorStop(1, `hsla(0, 100%, 10%, 0.8)`);
        ctx.fillStyle = vigGrad;
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        const dropSpacing = 200;
        const dOffsetX = -((s.cameraX * 0.1) % dropSpacing);
        for (let x = dOffsetX - 100; x < CANVAS_WIDTH + 100; x += dropSpacing) {
          for (let y = 0; y < CANVAS_HEIGHT; y += 200) {
            const hash = Math.sin(x * 7.7 + y * 13.3) * 1000;
            const speed = 0.15 * (Math.abs(hash) % 3 + 1);
            const dropY = (time * speed + hash * 100) % CANVAS_HEIGHT;
            const dropX = x + Math.sin(time * 0.001 + hash) * 20;
            const r = 6 + Math.abs(hash % 6);
            
            ctx.fillStyle = `hsla(0, 100%, 40%, 0.8)`;
            ctx.shadowBlur = 10;
            ctx.shadowColor = `hsla(0, 100%, 30%, 0.8)`;
            
            ctx.beginPath();
            ctx.arc(dropX, dropY, r, 0, Math.PI);
            ctx.moveTo(dropX - r, dropY);
            ctx.quadraticCurveTo(dropX, dropY - r * 3, dropX + r, dropY);
            ctx.fill();
            ctx.shadowBlur = 0;
          }
        }
        ctx.restore();
      };

      const drawTheme = (name: string, alpha: number) => {
        if (name === 'surface') drawSurface(alpha);
        else if (name === 'underwater') drawUnderwater(alpha);
        else if (name === 'deep_ocean') drawDeepOcean(alpha);
        else if (name === 'abyss') drawAbyss(alpha);
        else if (name === 'lava') drawLava(alpha);
        else if (name === 'neon') drawNeon(alpha);
        else if (name === 'toxic') drawToxic(alpha);
        else if (name === 'blood') drawBlood(alpha);
      };

      drawTheme(theme.theme1Name, 1 - theme.transitionProgress);
      drawTheme(theme.theme2Name, theme.transitionProgress);

      // Obstacles
      for (const obs of s.obstacles) {
        if (obs.x + obs.width - s.cameraX < -200 || obs.x - s.cameraX > CANVAS_WIDTH + 200) continue;

        ctx.save();
        ctx.translate(obs.x - s.cameraX, obs.yOffset);

        // 1. Draw Base Shape
        ctx.beginPath();
        ctx.moveTo(obs.points[0].x, obs.points[0].y);
        for (let i = 1; i < obs.points.length; i++) {
          ctx.lineTo(obs.points[i].x, obs.points[i].y);
        }
        ctx.closePath();

        // Base Fill
        const grad = ctx.createLinearGradient(0, obs.isTop ? -500 : 500, 0, 0);
        grad.addColorStop(0, `hsl(${theme.structBase[0]}, ${theme.structBase[1]}%, 8%)`);
        grad.addColorStop(1, `hsl(${theme.structBase[0]}, ${theme.structBase[1]}%, 15%)`);
        ctx.fillStyle = grad;
        ctx.fill();

        // 2. Clip for interior details
        ctx.save();
        ctx.clip();

        const themeName = theme.theme1Name;
        const t = time * 0.001;

        if (themeName === 'surface') {
          // Dark blue starry texture
          for(let i = 0; i < obs.width; i+= 30) {
            for(let j = -200; j < 200; j+= 30) {
              const hash = Math.sin(i * 1.3 + j * 2.7) * 1000;
              if (hash - Math.floor(hash) > 0.7) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
                ctx.beginPath();
                ctx.arc(i + (hash%20), (obs.isTop ? obs.points[2].y - 50 + j : obs.points[2].y + 50 + j), 2, 0, Math.PI*2);
                ctx.fill();
              }
            }
          }
          
          // Geometric inner glow
          ctx.strokeStyle = `hsla(190, 100%, 50%, 0.2)`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(obs.points[1].x, obs.points[1].y + (obs.isTop ? -20 : 20));
          ctx.lineTo(obs.points[2].x, obs.points[2].y + (obs.isTop ? -20 : 20));
          ctx.lineTo(obs.points[3].x, obs.points[3].y + (obs.isTop ? -20 : 20));
          ctx.stroke();
        } 
        else if (themeName === 'underwater') {
          // Caustics
          ctx.strokeStyle = `hsla(180, 100%, 70%, 0.2)`;
          ctx.lineWidth = 3;
          for(let i = -100; i < obs.width + 100; i+= 30) {
            ctx.beginPath();
            ctx.moveTo(i + Math.sin(t + i*0.05)*20, -1000);
            ctx.lineTo(i + Math.sin(t + i*0.05 + 5)*20, 1000);
            ctx.stroke();
          }
          // Bubbles clinging to rock
          ctx.fillStyle = `hsla(180, 100%, 80%, 0.3)`;
          for(let i = 0; i < obs.width; i+= 50) {
            const hash = Math.sin(i * 3.3) * 1000;
            const y = obs.isTop ? obs.points[2].y - 30 - (hash%50) : obs.points[2].y + 30 + (hash%50);
            ctx.beginPath();
            ctx.arc(i, y, 5 + (hash%5), 0, Math.PI*2);
            ctx.fill();
          }
          
          // Coral-like growths
          ctx.fillStyle = `hsla(320, 100%, 60%, 0.3)`;
          for (let i = 20; i < obs.width; i+= 80) {
            const hash = Math.sin(i * 4.1) * 1000;
            const y = obs.isTop ? obs.points[2].y - 10 : obs.points[2].y + 10;
            ctx.beginPath();
            ctx.arc(i, y, 15 + (hash%10), 0, Math.PI*2);
            ctx.fill();
          }
        }
        else if (themeName === 'deep_ocean') {
          // Bioluminescent veins
          ctx.strokeStyle = `hsla(200, 100%, 60%, 0.4)`;
          ctx.lineWidth = 2;
          for(let i = 0; i < obs.width; i+= 80) {
            ctx.beginPath();
            ctx.moveTo(i, obs.points[2].y);
            let currX = i;
            let currY = obs.points[2].y;
            for(let j = 0; j < 5; j++) {
              currX += (Math.sin(i + j) * 40);
              currY += obs.isTop ? -40 : 40;
              ctx.lineTo(currX, currY);
            }
            ctx.stroke();
          }
          
          // Glowing nodes
          ctx.fillStyle = `hsla(280, 100%, 70%, 0.5)`;
          ctx.shadowBlur = 10;
          ctx.shadowColor = `hsla(280, 100%, 70%, 0.8)`;
          for (let i = 40; i < obs.width; i+= 120) {
            const hash = Math.sin(i * 2.5) * 1000;
            const y = obs.isTop ? obs.points[2].y - 40 - (hash%40) : obs.points[2].y + 40 + (hash%40);
            ctx.beginPath();
            ctx.arc(i, y, 8, 0, Math.PI*2);
            ctx.fill();
          }
          ctx.shadowBlur = 0;
        }
        else if (themeName === 'abyss') {
          // Creepy eyes in the dark rock
          for(let i = 40; i < obs.width; i+= 100) {
            const hash = Math.sin(i * 1.1) * 1000;
            if (Math.abs(hash) % 3 > 1) {
              const y = obs.isTop ? obs.points[2].y - 60 - (hash%100) : obs.points[2].y + 60 + (hash%100);
              const blink = Math.sin(t * 2 + hash) > 0.8 ? 0.1 : 1;
              ctx.fillStyle = `hsla(0, 100%, 50%, ${0.8 * blink})`;
              ctx.shadowBlur = 15;
              ctx.shadowColor = `hsla(0, 100%, 50%, 0.8)`;
              ctx.beginPath();
              ctx.ellipse(i - 10, y, 6, 2 * blink, 0, 0, Math.PI*2);
              ctx.ellipse(i + 10, y, 6, 2 * blink, 0, 0, Math.PI*2);
              ctx.fill();
              ctx.shadowBlur = 0;
            }
          }
          
          // Dark organic webbing
          ctx.strokeStyle = `hsla(260, 100%, 20%, 0.3)`;
          ctx.lineWidth = 1;
          for(let i = 0; i < obs.width; i+= 40) {
            ctx.beginPath();
            ctx.moveTo(i, obs.points[2].y);
            ctx.lineTo(i + 40, obs.isTop ? obs.points[2].y - 100 : obs.points[2].y + 100);
            ctx.moveTo(i + 40, obs.points[2].y);
            ctx.lineTo(i, obs.isTop ? obs.points[2].y - 100 : obs.points[2].y + 100);
            ctx.stroke();
          }
        }
        else if (themeName === 'lava') {
          // Magma cracks
          ctx.strokeStyle = `hsla(15, 100%, 50%, 0.8)`;
          ctx.lineWidth = 3;
          ctx.shadowBlur = 10;
          ctx.shadowColor = '#ff4400';
          for(let i = 20; i < obs.width; i+= 60) {
            ctx.beginPath();
            ctx.moveTo(i, obs.points[2].y);
            let currX = i;
            let currY = obs.points[2].y;
            for(let j = 0; j < 4; j++) {
              const hash = Math.sin(currX * 2.2 + currY * 3.3) * 100;
              currX += (hash % 40) - 20;
              currY += obs.isTop ? -30 : 30;
              ctx.lineTo(currX, currY);
            }
            ctx.stroke();
          }
          ctx.shadowBlur = 0;
          
          // Glowing embers inside rock
          ctx.fillStyle = `hsla(30, 100%, 60%, 0.6)`;
          for (let i = 10; i < obs.width; i+= 50) {
            const hash = Math.sin(i * 5.1) * 1000;
            const y = obs.isTop ? obs.points[2].y - 20 - (hash%30) : obs.points[2].y + 20 + (hash%30);
            ctx.beginPath();
            ctx.arc(i, y, 3 + (hash%3), 0, Math.PI*2);
            ctx.fill();
          }
        }
        else if (themeName === 'neon') {
          // Tech grid
          ctx.strokeStyle = `hsla(${theme.structGlow[0]}, ${theme.structGlow[1]}%, 60%, 0.15)`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          const gridSize = 30;
          for (let i = -1000; i < obs.width + 1000; i += gridSize) {
            ctx.moveTo(i, -1000);
            ctx.lineTo(i, 1000);
          }
          for (let i = -1000; i < 1000; i += gridSize) {
            ctx.moveTo(-1000, i);
            ctx.lineTo(obs.width + 1000, i);
          }
          ctx.stroke();
          
          // Circuit lines
          ctx.strokeStyle = `hsla(${theme.structGlow[0]}, ${theme.structGlow[1]}%, 80%, 0.4)`;
          ctx.lineWidth = 2;
          for (let i = 50; i < obs.width; i+= 150) {
            ctx.beginPath();
            ctx.moveTo(i, obs.points[2].y);
            ctx.lineTo(i, obs.isTop ? obs.points[2].y - 40 : obs.points[2].y + 40);
            ctx.lineTo(i + 40, obs.isTop ? obs.points[2].y - 80 : obs.points[2].y + 80);
            ctx.lineTo(i + 100, obs.isTop ? obs.points[2].y - 80 : obs.points[2].y + 80);
            ctx.stroke();
            
            ctx.fillStyle = `hsla(${theme.structGlow[0]}, ${theme.structGlow[1]}%, 80%, 0.8)`;
            ctx.beginPath();
            ctx.arc(i + 100, obs.isTop ? obs.points[2].y - 80 : obs.points[2].y + 80, 4, 0, Math.PI*2);
            ctx.fill();
          }
        }
        else if (themeName === 'toxic') {
          // Rusty metal plates
          ctx.strokeStyle = `hsla(100, 50%, 20%, 0.5)`;
          ctx.lineWidth = 2;
          for(let i = 0; i < obs.width; i+= 80) {
            ctx.strokeRect(i, obs.isTop ? obs.points[2].y - 200 : obs.points[2].y, 80, 200);
            // Rivets
            ctx.fillStyle = `hsla(100, 50%, 15%, 0.8)`;
            ctx.beginPath();
            ctx.arc(i + 10, obs.isTop ? obs.points[2].y - 10 : obs.points[2].y + 10, 3, 0, Math.PI*2);
            ctx.arc(i + 70, obs.isTop ? obs.points[2].y - 10 : obs.points[2].y + 10, 3, 0, Math.PI*2);
            ctx.fill();
            
            // Cross braces
            ctx.beginPath();
            ctx.moveTo(i, obs.isTop ? obs.points[2].y - 200 : obs.points[2].y);
            ctx.lineTo(i + 80, obs.isTop ? obs.points[2].y : obs.points[2].y + 200);
            ctx.stroke();
          }
          // Dripping slime
          ctx.fillStyle = `hsla(120, 100%, 40%, 0.8)`;
          ctx.shadowBlur = 15;
          ctx.shadowColor = `hsla(120, 100%, 50%, 0.8)`;
          ctx.beginPath();
          ctx.moveTo(0, obs.points[1].y);
          for(let i = 0; i <= obs.width; i+= 10) {
            const drop = Math.sin(i * 0.2) > 0.5 ? Math.sin(t * 2 + i) * 30 : 0;
            const y = i < obs.width/2 
              ? obs.points[1].y + (obs.points[2].y - obs.points[1].y)*(i/(obs.width/2)) 
              : obs.points[2].y + (obs.points[3].y - obs.points[2].y)*((i-obs.width/2)/(obs.width/2));
            ctx.lineTo(i, y + (obs.isTop ? -drop : drop));
          }
          ctx.lineTo(obs.width, obs.isTop ? -1000 : 1000);
          ctx.lineTo(0, obs.isTop ? -1000 : 1000);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
        else if (themeName === 'blood') {
          // Fleshy veins
          ctx.strokeStyle = `hsla(0, 100%, 30%, 0.6)`;
          ctx.lineWidth = 4;
          for(let i = 20; i < obs.width; i+= 50) {
            ctx.beginPath();
            ctx.moveTo(i, obs.points[2].y);
            ctx.quadraticCurveTo(i + 30, obs.points[2].y + (obs.isTop ? -50 : 50), i - 10, obs.points[2].y + (obs.isTop ? -100 : 100));
            ctx.stroke();
            
            // Branching veins
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(i + 15, obs.points[2].y + (obs.isTop ? -25 : 25));
            ctx.quadraticCurveTo(i + 40, obs.points[2].y + (obs.isTop ? -40 : 40), i + 50, obs.points[2].y + (obs.isTop ? -60 : 60));
            ctx.stroke();
            ctx.lineWidth = 4;
          }
          
          // Pulsing nodes
          ctx.fillStyle = `hsla(0, 100%, 40%, 0.8)`;
          for (let i = 40; i < obs.width; i+= 90) {
            const hash = Math.sin(i * 6.1) * 1000;
            const y = obs.isTop ? obs.points[2].y - 30 - (hash%40) : obs.points[2].y + 30 + (hash%40);
            const pulse = 1 + Math.sin(t * 5 + hash) * 0.2;
            ctx.beginPath();
            ctx.arc(i, y, 8 * pulse, 0, Math.PI*2);
            ctx.fill();
          }
        }

        ctx.restore(); // End clip

        // 3. Edge Line
        ctx.beginPath();
        ctx.moveTo(obs.points[1].x, obs.points[1].y);
        ctx.lineTo(obs.points[2].x, obs.points[2].y);
        ctx.lineTo(obs.points[3].x, obs.points[3].y);
        
        if (themeName === 'surface') {
          ctx.strokeStyle = '#ffffff'; // White
          ctx.lineWidth = 4;
          ctx.shadowBlur = 15;
          ctx.shadowColor = '#22d3ee'; // Cyan glow
        } else if (themeName === 'underwater') {
          ctx.strokeStyle = '#06b6d4'; // Cyan
          ctx.lineWidth = 5;
        } else if (themeName === 'deep_ocean') {
          ctx.strokeStyle = '#0284c7'; // Deep blue
          ctx.lineWidth = 4;
        } else if (themeName === 'abyss') {
          ctx.strokeStyle = '#7c3aed'; // Purple
          ctx.lineWidth = 5;
        } else if (themeName === 'lava') {
          ctx.strokeStyle = '#f97316'; // Orange
          ctx.lineWidth = 6;
          ctx.shadowBlur = 15;
          ctx.shadowColor = '#ea580c';
        } else if (themeName === 'neon') {
          ctx.strokeStyle = `hsl(${theme.structGlow[0]}, 100%, 70%)`;
          ctx.lineWidth = 4;
          ctx.shadowBlur = 15;
          ctx.shadowColor = `hsl(${theme.structGlow[0]}, 100%, 50%)`;
        } else if (themeName === 'toxic') {
          ctx.strokeStyle = '#84cc16'; // Lime
          ctx.lineWidth = 5;
        } else if (themeName === 'blood') {
          ctx.strokeStyle = '#dc2626'; // Red
          ctx.lineWidth = 6;
        }

        ctx.stroke();
        ctx.shadowBlur = 0; // Reset shadow

        // Core white line for some themes
        if (['neon', 'underwater', 'deep_ocean', 'lava'].includes(themeName)) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = themeName === 'neon' ? 2 : 1;
          ctx.stroke();
        }

        // 4. Spikes
        for (let i = 0; i < obs.points.length - 1; i++) {
          if (!obs.hasSpikes[i]) continue;
          const p1 = obs.points[i];
          const p2 = obs.points[i+1];
          
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const len = Math.hypot(dx, dy);
          if (len === 0) continue;
          
          const tx = dx / len;
          const ty = dy / len;
          const nx = obs.isTop ? -ty : ty;
          const ny = obs.isTop ? tx : -tx;
          
          const numSpikes = Math.floor(len / 35);
          const spikeW = 14;
          const spikeH = 22;
          
          for (let j = 1; j < numSpikes; j++) {
            const pt = j / numSpikes;
            const sx = p1.x + dx * pt;
            const sy = p1.y + dy * pt;
            
            const tipX = sx + nx * spikeH;
            const tipY = sy + ny * spikeH;
            const base1X = sx - tx * spikeW;
            const base1Y = sy - ty * spikeW;
            const base2X = sx + tx * spikeW;
            const base2Y = sy + ty * spikeW;

            if (themeName === 'underwater' || themeName === 'deep_ocean') {
              // Crystals
              ctx.fillStyle = themeName === 'underwater' ? '#0891b2' : '#0369a1';
              ctx.beginPath();
              ctx.moveTo(base1X, base1Y);
              ctx.lineTo(tipX, tipY);
              ctx.lineTo(base2X, base2Y);
              ctx.fill();
              // Crystal highlight
              ctx.fillStyle = '#67e8f9';
              ctx.beginPath();
              ctx.moveTo(sx, sy);
              ctx.lineTo(tipX, tipY);
              ctx.lineTo(base2X, base2Y);
              ctx.fill();
            }
            else if (themeName === 'abyss') {
              // Shadow tendrils
              ctx.strokeStyle = '#000000';
              ctx.lineWidth = 4;
              ctx.beginPath();
              ctx.moveTo(sx, sy);
              const wave = Math.sin(t * 5 + j) * 10;
              ctx.quadraticCurveTo(sx + nx * spikeH * 0.5 + tx * wave, sy + ny * spikeH * 0.5 + ty * wave, tipX + tx * wave, tipY + ty * wave);
              ctx.stroke();
            }
            else if (themeName === 'lava') {
              // Obsidian shards with lava core
              ctx.fillStyle = '#171717';
              ctx.beginPath();
              ctx.moveTo(base1X, base1Y);
              ctx.lineTo(tipX, tipY);
              ctx.lineTo(base2X, base2Y);
              ctx.fill();
              // Lava core
              ctx.strokeStyle = '#ea580c';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(sx, sy);
              ctx.lineTo(sx + nx * spikeH * 0.7, sy + ny * spikeH * 0.7);
              ctx.stroke();
            }
            else if (themeName === 'toxic') {
              // Rusty pipes
              ctx.fillStyle = '#3f6212';
              ctx.beginPath();
              ctx.moveTo(sx - tx * 4, sy - ty * 4);
              ctx.lineTo(sx - tx * 4 + nx * spikeH, sy - ty * 4 + ny * spikeH);
              ctx.lineTo(sx + tx * 4 + nx * spikeH, sy + ty * 4 + ny * spikeH);
              ctx.lineTo(sx + tx * 4, sy + ty * 4);
              ctx.fill();
              // Acid drip
              ctx.fillStyle = '#84cc16';
              ctx.beginPath();
              ctx.arc(tipX, tipY + (obs.isTop ? Math.sin(t*3+j)*5 : -Math.sin(t*3+j)*5), 3, 0, Math.PI*2);
              ctx.fill();
            }
            else if (themeName === 'blood') {
              // Teeth
              ctx.fillStyle = '#fef08a'; // Yellowish white
              ctx.beginPath();
              ctx.moveTo(base1X, base1Y);
              ctx.quadraticCurveTo(sx + nx * spikeH * 0.8, sy + ny * spikeH * 0.8, tipX, tipY);
              ctx.quadraticCurveTo(sx + nx * spikeH * 0.2, sy + ny * spikeH * 0.2, base2X, base2Y);
              ctx.fill();
              ctx.strokeStyle = '#991b1b';
              ctx.lineWidth = 1;
              ctx.stroke();
            }
            else {
              // Neon / Default (Modern Spikes)
              ctx.beginPath();
              ctx.moveTo(base1X, base1Y);
              ctx.lineTo(tipX, tipY);
              ctx.lineTo(base2X, base2Y);
              ctx.closePath();
              
              ctx.fillStyle = `hsl(${theme.spikeColor[0]}, ${theme.spikeColor[1]}%, 15%)`;
              ctx.fill();
              
              if (themeName === 'surface') {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.save();
                ctx.shadowBlur = 10;
                ctx.shadowColor = '#22d3ee';
                ctx.stroke();
                ctx.restore();
              } else {
                ctx.strokeStyle = `hsl(${theme.spikeColor[0]}, 100%, 60%)`;
                ctx.lineWidth = 2;
                ctx.save();
                ctx.shadowBlur = 10;
                ctx.shadowColor = `hsl(${theme.spikeColor[0]}, 100%, 50%)`;
                ctx.stroke();
                ctx.restore();
              }
            }
          }
        }

        ctx.restore();
      }

      // Portals
      for (const portal of s.portals) {
        const screenX = portal.x - s.cameraX;
        if (screenX < -100 || screenX > CANVAS_WIDTH + 100) continue;

        ctx.save();
        ctx.translate(screenX, portal.y);

        const pulse = Math.sin(time / 150) * 0.5 + 0.5;

        const baseColor = portal.type === 'speed_0' ? '255, 170, 0' : 
                          portal.type === 'speed_1' ? '100, 200, 255' : 
                          portal.type === 'speed_2' ? '0, 255, 0' : 
                          portal.type === 'speed_3' ? '255, 0, 255' : 
                          portal.type === 'speed_4' ? '255, 0, 0' :
                          portal.type === 'mini' ? '255, 100, 200' : '100, 200, 255';
        ctx.strokeStyle = `rgba(${baseColor}, ${0.5 + pulse * 0.5})`;
        ctx.lineWidth = 14;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        const drawArrow = (offsetX: number, reversed: boolean) => {
          ctx.beginPath();
          if (reversed) {
            ctx.moveTo(offsetX + 15, -30);
            ctx.lineTo(offsetX - 15, 0);
            ctx.lineTo(offsetX + 15, 30);
          } else {
            ctx.moveTo(offsetX - 15, -30);
            ctx.lineTo(offsetX + 15, 0);
            ctx.lineTo(offsetX - 15, 30);
          }
          ctx.stroke();
        };

        if (portal.type === 'speed_0') {
          drawArrow(0, true);
        } else if (portal.type === 'speed_1') {
          drawArrow(0, false);
        } else if (portal.type === 'speed_2') {
          drawArrow(-15, false);
          drawArrow(15, false);
        } else if (portal.type === 'speed_3') {
          drawArrow(-25, false);
          drawArrow(0, false);
          drawArrow(25, false);
        } else if (portal.type === 'speed_4') {
          drawArrow(-35, false);
          drawArrow(-12, false);
          drawArrow(11, false);
          drawArrow(34, false);
        } else if (portal.type === 'mini' || portal.type === 'normal') {
          ctx.beginPath();
          ctx.ellipse(0, 0, 20, 40, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.lineWidth = 4;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
        }

        ctx.restore();
      }

      // Player and Trail
      if (s.status === 'playing' || s.status === 'menu' || s.status === 'level_complete') {
        // Trail
        if (s.player.trail.length > 0) {
          ctx.beginPath();
          ctx.moveTo(s.player.trail[0].x - s.cameraX, s.player.trail[0].y);
          for (let i = 1; i < s.player.trail.length; i++) {
            ctx.lineTo(s.player.trail[i].x - s.cameraX, s.player.trail[i].y);
          }
          if (s.status === 'playing' || s.status === 'level_complete') {
            ctx.lineTo(s.player.screenX, s.player.y);
          }
          
          ctx.strokeStyle = 'rgba(0, 255, 255, 0.3)';
          ctx.lineWidth = 10 * s.player.size;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.stroke();
          
          ctx.strokeStyle = '#00ffff';
          ctx.lineWidth = 3 * s.player.size;
          ctx.stroke();
        }

        // Player
        ctx.save();
        ctx.translate(s.player.screenX, s.player.y);
        
        const currentSpeedX = s.player.speedLevel === 0 ? 350 : s.player.speedLevel === 1 ? 450 : s.player.speedLevel === 2 ? 580 : s.player.speedLevel === 3 ? 720 : 900;
        const currentSpeedY = currentSpeedX * (s.player.isMini ? 1.732 : 1);
        const targetAngle = Math.atan(currentSpeedY / currentSpeedX);
        const targetRotation = s.player.isHolding ? -targetAngle : targetAngle;
        
        s.player.rotation += (targetRotation - s.player.rotation) * 20 * dt;
        ctx.rotate(s.player.rotation);
        const baseScale = s.player.isMini ? 0.5 : 1.0;
        ctx.scale(s.player.size * baseScale, s.player.size * baseScale);

        // Draw player (cyan wave with dark outline)
        ctx.fillStyle = `hsl(${theme.structGlow[0]}, 100%, 60%)`;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        
        ctx.beginPath();
        ctx.moveTo(16, 0);
        ctx.lineTo(-10, 12);
        ctx.lineTo(-4, 0);
        ctx.lineTo(-10, -12);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        // Inner detail
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(-6, 6);
        ctx.lineTo(-2, 0);
        ctx.lineTo(-6, -6);
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        ctx.restore();
      }

      if (s.status === 'gameover' || s.status === 'level_complete') {
        for (const p of s.particles) {
          ctx.globalAlpha = Math.max(0, p.life);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1.0;
      }

      if (s.botEnabled) {
        ctx.fillStyle = '#00ff00';
        ctx.font = 'bold 20px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.fillText('BOT ENABLED (B to disable)', CANVAS_WIDTH - 20, 40);
      }

      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [generateMoreObstacles, die]);

  useEffect(() => {
    const handleDown = (e: Event) => {
      if (e.type === 'keydown') {
        const keyEvent = e as KeyboardEvent;
        if (keyEvent.code === 'KeyB') {
          state.current.botEnabled = !state.current.botEnabled;
          return;
        }
        if (keyEvent.code !== 'Space') return;
      }
      
      if (e.target instanceof HTMLElement && (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.tagName === 'INPUT')) {
        return;
      }
      
      if (e.cancelable) {
        e.preventDefault();
      }
      
      if (state.current.status === 'menu' || state.current.status === 'gameover' || state.current.status === 'level_complete') {
        if (state.current.status === 'gameover') {
          startGame();
        }
      } else {
        if (!state.current.botEnabled) {
          state.current.player.isHolding = true;
        }
      }
    };

    const handleUp = (e: Event) => {
      if (e.type === 'keyup' && (e as KeyboardEvent).code !== 'Space') return;
      
      if (e.target instanceof HTMLElement && (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.tagName === 'INPUT')) {
        return;
      }
      
      if (e.cancelable) {
        e.preventDefault();
      }
      if (!state.current.botEnabled) {
        state.current.player.isHolding = false;
      }
    };

    window.addEventListener('keydown', handleDown, { passive: false });
    window.addEventListener('keyup', handleUp);
    window.addEventListener('pointerdown', handleDown, { passive: false });
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('touchstart', handleDown, { passive: false });
    window.addEventListener('touchend', handleUp, { passive: false });

    return () => {
      window.removeEventListener('keydown', handleDown);
      window.removeEventListener('keyup', handleUp);
      window.removeEventListener('pointerdown', handleDown);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('touchstart', handleDown);
      window.removeEventListener('touchend', handleUp);
    };
  }, [startGame]);

  return (
    <div className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-center font-sans selection:bg-pink-500/30 overflow-hidden touch-none">
      <audio ref={audioRef} preload="auto" />
      <div className="relative bg-black overflow-hidden shadow-2xl shadow-cyan-900/20 w-full max-w-5xl aspect-[4/3] md:rounded-2xl border-y md:border border-white/10 ring-1 ring-white/5 shrink-0">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="block w-full h-full object-contain touch-none"
        />

        <AnimatePresence>
          {uiState.status === 'menu' && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05, filter: 'blur(10px)' }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm"
            >
              <WaveBackground />
              <div className="z-10 flex flex-col items-center">
                <motion.h1 
                  initial={{ y: -50, opacity: 0 }}
                  animate={{ y: 0, opacity: 1, scale: [1, 1.05, 1], rotate: [-2, 2, -2] }}
                  transition={{ 
                    y: { delay: 0.1, type: "spring", stiffness: 200 },
                    opacity: { delay: 0.1 },
                    scale: { repeat: Infinity, duration: 2, ease: "easeInOut" },
                    rotate: { repeat: Infinity, duration: 4, ease: "easeInOut" }
                  }}
                  className="text-7xl font-black text-transparent bg-clip-text bg-gradient-to-br from-cyan-400 via-blue-500 to-pink-500 mb-6 tracking-tighter italic drop-shadow-lg text-center"
                >
                  TIDAL WAVE MIX
                </motion.h1>
                
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="flex flex-wrap justify-center gap-2 mb-8 max-w-2xl px-4"
                >
                  {(Object.keys(DIFFICULTY_PROPS) as Difficulty[]).map(diff => (
                    <button
                      key={diff}
                      onClick={(e) => { e.stopPropagation(); setUiState(prev => ({ ...prev, difficulty: diff })); state.current.difficulty = diff; }}
                      className={`px-4 py-2 rounded-full font-bold text-sm transition-all border ${uiState.difficulty === diff ? 'bg-white text-black border-white scale-110 shadow-[0_0_20px_rgba(255,255,255,0.5)]' : 'bg-black/50 text-white/70 border-white/20 hover:bg-white/10'}`}
                    >
                      {diff}
                    </button>
                  ))}
                </motion.div>

                <motion.p 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="text-white/80 mb-10 font-mono text-sm uppercase tracking-[0.3em] bg-black/50 px-4 py-2 rounded-full border border-white/10"
                >
                  Hold to go up, release to go down
                </motion.p>
                
                <div className="flex flex-col items-center gap-4">
                  <div className="flex gap-4">
                    <motion.button 
                      initial={{ y: 50, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      whileHover={audioInfo?.url ? { scale: 1.05, boxShadow: "0 0 60px rgba(0,255,255,0.5)" } : {}}
                      whileTap={audioInfo?.url ? { scale: 0.95 } : {}}
                      transition={{ delay: 0.4, type: "spring" }}
                      onClick={(e) => { e.stopPropagation(); startGame(); }}
                      disabled={!audioInfo?.url || isAnalyzing}
                      className={`px-10 py-5 rounded-full font-bold text-xl flex items-center gap-3 transition-all ${
                        audioInfo?.url && !isAnalyzing
                          ? 'bg-white text-black shadow-[0_0_40px_rgba(0,255,255,0.3)]' 
                          : 'bg-white/20 text-white/50 cursor-not-allowed'
                      }`}
                    >
                      {isAnalyzing ? (
                        <div className="w-6 h-6 border-2 border-white/50 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Play className="w-7 h-7 fill-current" />
                      )}
                      {isAnalyzing ? 'LOADING AUDIO...' : 'PLAY NOW'}
                    </motion.button>
                  </div>
                  {audioInfo?.url && !isAnalyzing && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-2 text-green-400 font-mono text-sm bg-green-400/10 px-4 py-2 rounded-full border border-green-400/20"
                    >
                      <Music className="w-4 h-4" />
                      Tidal Wave loaded ({audioInfo.bpm} BPM)
                    </motion.div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {uiState.status === 'level_complete' && (
            <motion.div 
              initial={{ opacity: 0, backgroundColor: "rgba(0,255,255,0.0)" }}
              animate={{ opacity: 1, backgroundColor: "rgba(0,0,0,0.9)" }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="absolute inset-0 flex flex-col items-center justify-center backdrop-blur-lg z-50"
            >
              <motion.h2 
                initial={{ scale: 0, opacity: 0, rotate: 180 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={{ type: "spring", damping: 15, stiffness: 100, delay: 0.2 }}
                className="text-6xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-600 mb-4 italic tracking-tighter drop-shadow-[0_0_30px_rgba(0,255,255,0.8)]"
              >
                LEVEL COMPLETE
              </motion.h2>
              <motion.div 
                initial={{ y: 50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4, type: "spring" }}
                className="flex gap-12 my-10"
              >
                <div className="text-center bg-white/5 px-8 py-4 rounded-2xl border border-white/10 shadow-[0_0_30px_rgba(0,255,255,0.2)]">
                  <p className="text-white/50 text-sm font-mono mb-2 tracking-widest">FINAL SCORE</p>
                  <p className="text-6xl font-bold text-cyan-400">{uiState.score}</p>
                </div>
              </motion.div>
              <motion.button 
                initial={{ y: 50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                whileHover={{ scale: 1.05, boxShadow: "0 0 60px rgba(0,255,255,0.5)" }}
                whileTap={{ scale: 0.95 }}
                transition={{ delay: 0.5, type: "spring" }}
                onClick={(e) => { e.stopPropagation(); setUiState(prev => ({ ...prev, status: 'menu' })); }}
                className="px-10 py-5 bg-white text-black rounded-full font-bold text-xl flex items-center gap-3 shadow-[0_0_40px_rgba(0,255,255,0.3)] mt-8"
              >
                <RotateCcw className="w-7 h-7" />
                CONTINUE
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {uiState.status === 'gameover' && (
            <motion.div 
              initial={{ opacity: 0, backgroundColor: "rgba(255,0,0,0.3)" }}
              animate={{ opacity: 1, backgroundColor: "rgba(0,0,0,0.8)" }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="absolute inset-0 flex flex-col items-center justify-center backdrop-blur-md"
            >
              <motion.h2 
                initial={{ scale: 0.5, opacity: 0, rotate: -10 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={{ type: "spring", damping: 12, stiffness: 200 }}
                className="text-6xl font-black text-white mb-2 italic tracking-tight text-red-500 drop-shadow-[0_0_20px_rgba(239,68,68,0.5)]"
              >
                CRASHED!
              </motion.h2>
              <motion.div 
                initial={{ y: 50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2, type: "spring" }}
                className="flex gap-12 my-10"
              >
                <div className="text-center bg-white/5 px-8 py-4 rounded-2xl border border-white/10">
                  <p className="text-white/50 text-sm font-mono mb-2 tracking-widest">SCORE</p>
                  <p className="text-5xl font-bold text-cyan-400">{uiState.score}</p>
                </div>
                <div className="text-center bg-white/5 px-8 py-4 rounded-2xl border border-white/10">
                  <p className="text-white/50 text-sm font-mono mb-2 tracking-widest">BEST</p>
                  <p className="text-5xl font-bold text-pink-500">{uiState.highScore}</p>
                </div>
              </motion.div>
              <motion.div className="flex gap-4">
                <motion.button 
                  initial={{ y: 50, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  whileHover={{ scale: 1.05, boxShadow: "0 0 60px rgba(255,0,85,0.5)" }}
                  whileTap={{ scale: 0.95 }}
                  transition={{ delay: 0.3, type: "spring" }}
                  onClick={(e) => { e.stopPropagation(); startGame(); }}
                  className="px-10 py-5 bg-white text-black rounded-full font-bold text-xl flex items-center gap-3 shadow-[0_0_40px_rgba(255,0,85,0.3)]"
                >
                  <RotateCcw className="w-7 h-7" />
                  TRY AGAIN
                </motion.button>
                <motion.button 
                  initial={{ y: 50, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  transition={{ delay: 0.4, type: "spring" }}
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    setUiState(prev => ({ ...prev, status: 'menu' }));
                    state.current.status = 'menu';
                    if (audioRef.current) audioRef.current.pause();
                  }}
                  className="px-10 py-5 bg-black/50 text-white border border-white/20 rounded-full font-bold text-xl flex items-center gap-3 hover:bg-white/10"
                >
                  MENU
                </motion.button>
              </motion.div>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
                className="mt-8 text-white/50 font-mono text-sm tracking-widest"
              >
                PRESS SPACE OR TAP TO RESTART
              </motion.p>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {uiState.status === 'level_complete' && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, backgroundColor: "rgba(255,255,255,0.9)" }}
              transition={{ duration: 1.5, delay: 1.0 }}
              className="absolute inset-0 flex flex-col items-center justify-center z-50"
            >
              <motion.h2 
                initial={{ scale: 0.5, opacity: 0, y: 50 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                transition={{ type: "spring", delay: 2.0 }}
                className="text-6xl md:text-8xl font-black text-black mb-4 tracking-tighter"
              >
                LEVEL COMPLETE!
              </motion.h2>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 2.5 }}
                className="flex gap-8 text-black/70 mb-12 font-mono text-xl"
              >
                <div className="text-center">
                  <p className="text-sm tracking-widest mb-1">FINAL SCORE</p>
                  <p className="text-4xl font-bold text-black">{uiState.score}</p>
                </div>
              </motion.div>
              <motion.button
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 3.0 }}
                onClick={(e) => { e.stopPropagation(); setUiState(prev => ({ ...prev, status: 'menu' })); }}
                className="px-10 py-5 bg-black text-white rounded-full font-bold text-xl flex items-center gap-3 shadow-2xl hover:scale-105 transition-transform"
              >
                CONTINUE
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {uiState.status === 'playing' && (
            <motion.div 
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 50 }}
              className="absolute top-6 right-8 text-right font-mono pointer-events-none"
            >
              <p className="text-white/50 text-xs mb-1 tracking-widest">SCORE</p>
              <p className="text-4xl font-bold text-white drop-shadow-md">{uiState.score}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
