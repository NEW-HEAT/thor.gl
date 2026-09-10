export interface City {
  name: string;
  coordinates: [number, number];
  population: number;
}

export const CITIES: City[] = [
  { name: "New York", coordinates: [-74.006, 40.7128], population: 8336 },
  { name: "London", coordinates: [-0.1276, 51.5074], population: 8982 },
  { name: "Tokyo", coordinates: [139.6917, 35.6895], population: 13960 },
  { name: "Sydney", coordinates: [151.2093, -33.8688], population: 5312 },
  { name: "Cairo", coordinates: [31.2357, 30.0444], population: 9540 },
  { name: "Mumbai", coordinates: [72.8777, 19.076], population: 12442 },
  { name: "Shanghai", coordinates: [121.4737, 31.2304], population: 24870 },
  { name: "Lagos", coordinates: [3.3792, 6.5244], population: 15388 },
  { name: "Mexico City", coordinates: [-99.1332, 19.4326], population: 9209 },
  { name: "Moscow", coordinates: [37.6173, 55.7558], population: 12506 },
  { name: "Rio de Janeiro", coordinates: [-43.1729, -22.9068], population: 6748 },
  { name: "Paris", coordinates: [2.3522, 48.8566], population: 2161 },
  { name: "Istanbul", coordinates: [28.9784, 41.0082], population: 15462 },
  { name: "Buenos Aires", coordinates: [-58.3816, -34.6037], population: 3076 },
  { name: "Nairobi", coordinates: [36.8219, -1.2921], population: 4397 },
  { name: "Singapore", coordinates: [103.8198, 1.3521], population: 5686 },
  { name: "Dubai", coordinates: [55.2708, 25.2048], population: 3490 },
  { name: "Bangkok", coordinates: [100.5018, 13.7563], population: 10539 },
  { name: "Seoul", coordinates: [126.978, 37.5665], population: 9776 },
  { name: "Cape Town", coordinates: [18.4241, -33.9249], population: 4618 },
];

