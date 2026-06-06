export default function Spinner({ large, center }) {
  const el = <span className={`spinner${large ? ' lg' : ''}`} />;
  if (center) return <div className="spinner-center">{el}</div>;
  return el;
}
