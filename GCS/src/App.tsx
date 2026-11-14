import "./App.css";
import { Canvas } from "@react-three/fiber";
import { useGLTF, OrbitControls } from "@react-three/drei";

function Scene() {
  const { scene } = useGLTF("/model.gltf");

  return <primitive object={scene} />;
}

function App() {
  return (
    <main className="container">
      <Canvas
        camera={{
          position: [0, 0, 35],
          fov: 65,
          near: 0.1,
          far: 1000,
        }}
      >
        <ambientLight intensity={1} />

        <directionalLight position={[5, 10, 5]} intensity={2} />

        <Scene />

        <OrbitControls />
      </Canvas>
    </main>
  );
}

export default App;
