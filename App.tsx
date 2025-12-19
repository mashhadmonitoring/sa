
import React, { useState, useMemo, useRef } from 'react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  Label
} from 'recharts';
import * as XLSX from 'xlsx';
import { WaterSample, SimilarityResult, ComparisonReport, NormalizationMethod } from './types';
import { 
  getOverlapData, 
  calculatePearson, 
  calculateRMSE, 
  calculateEuclidean, 
  calculateCosineSimilarity, 
  calculateSID,
  normalizeValues,
  applyMovingAverage
} from './utils/mathUtils';
import { getAIAnalysis } from './services/geminiService';
import { 
  BeakerIcon, 
  DocumentChartBarIcon, 
  TableCellsIcon, 
  SparklesIcon,
  PlusIcon,
  TrashIcon,
  ArrowPathIcon,
  ChartBarIcon,
  InformationCircleIcon,
  ArrowDownTrayIcon,
  AdjustmentsHorizontalIcon,
  CheckBadgeIcon,
  QuestionMarkCircleIcon,
  ArrowsRightLeftIcon,
  ViewfinderCircleIcon
} from '@heroicons/react/24/outline';

const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#4f46e5'];
const MAX_ALLOWED_WAVELENGTH = 300;

const App: React.FC = () => {
  const [samples, setSamples] = useState<WaterSample[]>([]);
  const [loading, setLoading] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [rangeMin, setRangeMin] = useState<number>(0);
  const [rangeMax, setRangeMax] = useState<number>(MAX_ALLOWED_WAVELENGTH);
  const [normMethod, setNormMethod] = useState<NormalizationMethod>('none');
  const [smoothingEnabled, setSmoothingEnabled] = useState(false);
  const [smoothingWindow, setSmoothingWindow] = useState(5);
  const reportRef = useRef<HTMLDivElement>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    setLoading(true);
    const newSamples: WaterSample[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const data = await parseFile(file);
        if (data.length > 0) {
          newSamples.push({
            id: Math.random().toString(36).substr(2, 9),
            name: file.name.split('.')[0],
            data,
            color: COLORS[(samples.length + newSamples.length) % COLORS.length]
          });
        }
      } catch (err) {
        console.error("Error parsing file:", file.name, err);
        alert(`Could not parse ${file.name}. Ensure it is a valid Excel or CSV file.`);
      }
    }

    const allUploadedSamples = [...samples, ...newSamples];
    setSamples(allUploadedSamples);
    
    if (allUploadedSamples.length > 0) {
        const minW = Math.min(...allUploadedSamples.flatMap(s => s.data.map(d => d.wavelength)));
        if (rangeMin === 0) setRangeMin(Math.floor(minW));
    }

    setLoading(false);
    if (event.target) event.target.value = '';
  };

  const parseFile = (file: File): Promise<{ wavelength: number; absorption: number }[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const isCsv = file.name.toLowerCase().endsWith('.csv');
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          let workbook = isCsv ? XLSX.read(data, { type: 'string' }) : XLSX.read(data, { type: 'binary' });
          const worksheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(worksheet);
          const result = jsonData.map((row: any) => {
            const keys = Object.keys(row);
            const wKey = keys.find(k => k.toLowerCase().trim().includes('wave') || k.toLowerCase().trim() === 'wavelength');
            const aKey = keys.find(k => k.toLowerCase().trim().includes('abs') || k.toLowerCase().trim() === 'absorption');
            if (wKey && aKey) {
              const w = parseFloat(row[wKey]);
              const a = parseFloat(row[aKey]);
              if (!isNaN(w) && !isNaN(a)) return { wavelength: w, absorption: a };
            }
            return null;
          }).filter(item => item !== null) as { wavelength: number; absorption: number }[];
          resolve(result.sort((a, b) => a.wavelength - b.wavelength));
        } catch (err) { reject(err); }
      };
      if (isCsv) reader.readAsText(file); else reader.readAsBinaryString(file);
    });
  };

  const removeSample = (id: string) => {
    setSamples(prev => prev.filter(s => s.id !== id));
    setAiResult(null);
  };

  const similarityMatrix = useMemo(() => {
    const results: SimilarityResult[] = [];
    for (let i = 0; i < samples.length; i++) {
      for (let j = i + 1; j < samples.length; j++) {
        const common = getOverlapData(samples[i].data, samples[j].data);
        let filteredCommon = common.filter(p => p.x >= rangeMin && p.x <= Math.min(rangeMax, MAX_ALLOWED_WAVELENGTH));
        
        if (filteredCommon.length > 0) {
          const calcMethod = normMethod === 'none' ? 'area' : normMethod;
          
          let yA = filteredCommon.map(p => p.yA);
          let yB = filteredCommon.map(p => p.yB);
          
          if (smoothingEnabled) {
            yA = applyMovingAverage(yA, smoothingWindow);
            yB = applyMovingAverage(yB, smoothingWindow);
          }

          const smoothedFilteredCommon = filteredCommon.map((p, idx) => ({
            ...p,
            yA: yA[idx],
            yB: yB[idx]
          }));

          results.push({
            sampleA: samples[i].name,
            sampleB: samples[j].name,
            pearson: calculatePearson(smoothedFilteredCommon),
            rmse: calculateRMSE(smoothedFilteredCommon, calcMethod),
            euclidean: calculateEuclidean(smoothedFilteredCommon, calcMethod),
            cosine: calculateCosineSimilarity(smoothedFilteredCommon),
            sid: calculateSID(smoothedFilteredCommon)
          });
        }
      }
    }
    return results;
  }, [samples, rangeMin, rangeMax, normMethod, smoothingEnabled, smoothingWindow]);

  const mergedChartData = useMemo(() => {
    if (samples.length === 0) return [];
    
    const allWavelengths = Array.from(new Set<number>(samples.flatMap(s => s.data.map(d => d.wavelength))))
      .filter(w => w >= rangeMin && w <= Math.min(rangeMax, MAX_ALLOWED_WAVELENGTH))
      .sort((a: number, b: number) => a - b);

    const sampleProcessedMap: Record<string, number[]> = {};
    samples.forEach(s => {
      let absValues = allWavelengths.map(w => {
         const found = s.data.find(d => d.wavelength === w);
         return found ? found.absorption : 0;
      });

      if (smoothingEnabled) {
        absValues = applyMovingAverage(absValues, smoothingWindow);
      }

      if (normMethod !== 'none') {
        absValues = normalizeValues(absValues, normMethod);
      }
      
      sampleProcessedMap[s.name] = absValues;
    });

    return allWavelengths.map((w, idx) => {
      const point: any = { wavelength: w };
      samples.forEach(s => {
        point[s.name] = sampleProcessedMap[s.name][idx];
      });
      return point;
    });
  }, [samples, rangeMin, rangeMax, normMethod, smoothingEnabled, smoothingWindow]);

  const handleAIAnalysis = async () => {
    if (samples.length < 2) return;
    setAnalyzing(true);
    const result = await getAIAnalysis({ samples, similarityMatrix });
    setAiResult(result);
    setAnalyzing(false);
  };

  const handleExportPDF = () => {
    if (!reportRef.current) return;
    setExporting(true);
    (window as any).html2pdf().set({
      margin: 10,
      filename: `SpectraSync_Report_${new Date().toISOString().split('T')[0]}.pdf`,
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(reportRef.current).save().then(() => setExporting(false));
  };

  const getMetricColor = (val: number, type: 'positive' | 'negative') => {
    if (type === 'positive') {
      if (val > 0.999) return 'text-emerald-700 bg-emerald-50';
      if (val > 0.95) return 'text-emerald-600 bg-emerald-50/50';
      if (val > 0.8) return 'text-amber-600 bg-amber-50/50';
      return 'text-rose-600 bg-rose-50/50';
    } else {
      if (val < 0.0001) return 'text-emerald-700 bg-emerald-50';
      if (val < 0.001) return 'text-emerald-600 bg-emerald-50/50';
      if (val < 0.1) return 'text-amber-600 bg-amber-50/50';
      return 'text-rose-600 bg-rose-50/50';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm no-print">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-lg shadow-lg shadow-blue-200">
              <BeakerIcon className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">SpectraSync</h1>
              <p className="text-[10px] text-blue-600 font-bold uppercase tracking-widest">UV High-Precision Lab</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {samples.length > 0 && (
              <button 
                onClick={handleExportPDF}
                disabled={exporting}
                className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl font-semibold hover:bg-slate-50 transition-colors shadow-sm text-sm"
              >
                {exporting ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <ArrowDownTrayIcon className="w-4 h-4" />}
                Export PDF
              </button>
            )}
            <label className="cursor-pointer bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-xl font-semibold transition-all duration-200 shadow-md flex items-center gap-2 group text-sm">
              <PlusIcon className="w-5 h-5 group-hover:rotate-90 transition-transform" />
              Upload Spectra
              <input type="file" multiple accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto px-6 py-10 w-full grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-3 space-y-6 no-print">
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <AdjustmentsHorizontalIcon className="w-4 h-4" />
              Wavelength Range (nm)
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Min</label>
                <input type="number" value={rangeMin} onChange={(e) => setRangeMin(parseInt(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Max (≤300)</label>
                <input type="number" value={rangeMax} max={MAX_ALLOWED_WAVELENGTH} onChange={(e) => setRangeMax(Math.min(parseInt(e.target.value), MAX_ALLOWED_WAVELENGTH))} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
            </div>
          </section>

          <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <ArrowsRightLeftIcon className="w-4 h-4" />
              Normalization Method
            </h2>
            <div className="flex flex-col gap-2">
              {[
                { id: 'none', label: 'Raw Data', desc: 'Original absorbance values.' },
                { id: 'area', label: 'Area Normalized', desc: 'Integral of curve = 1. Best for concentration variations.' },
                { id: 'minmax', label: 'Min-Max Scaling', desc: 'Range [0, 1]. Best for comparing peak positions.' }
              ].map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setNormMethod(opt.id as NormalizationMethod)}
                  className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                    normMethod === opt.id 
                      ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' 
                      : 'border-slate-100 bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <span className={`text-xs font-bold ${normMethod === opt.id ? 'text-blue-700' : 'text-slate-700'}`}>{opt.label}</span>
                  <span className="text-[10px] text-slate-500 mt-0.5 leading-tight">{opt.desc}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <ViewfinderCircleIcon className="w-4 h-4" />
              Spectral Smoothing
            </h2>
            <div className="space-y-4">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative">
                  <input 
                    type="checkbox" 
                    className="sr-only peer" 
                    checked={smoothingEnabled} 
                    onChange={(e) => setSmoothingEnabled(e.target.checked)} 
                  />
                  <div className="w-10 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                </div>
                <span className="text-xs font-bold text-slate-700">Enable Smoothing</span>
              </label>
              
              {smoothingEnabled && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Window Size</label>
                    <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{smoothingWindow} pts</span>
                  </div>
                  <input 
                    type="range" 
                    min="3" 
                    max="21" 
                    step="2" 
                    value={smoothingWindow} 
                    onChange={(e) => setSmoothingWindow(parseInt(e.target.value))} 
                    className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <p className="text-[9px] text-slate-400 italic leading-tight">Moving average filter to reduce high-frequency noise.</p>
                </div>
              )}
            </div>
          </section>

          <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <DocumentChartBarIcon className="w-4 h-4" />
              Water Samples
            </h2>
            {samples.length === 0 ? (
              <p className="text-slate-400 text-xs italic text-center py-4">No data loaded.</p>
            ) : (
              <ul className="space-y-3">
                {samples.map(sample => (
                  <li key={sample.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100 group transition-colors">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-4 h-4 rounded-full flex-shrink-0 shadow-sm" style={{ backgroundColor: sample.color }} />
                      <span className="text-sm font-semibold text-slate-700 truncate">{sample.name}</span>
                    </div>
                    <button onClick={() => removeSample(sample.id)} className="p-1.5 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition">
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {samples.length >= 2 && (
            <button 
              onClick={handleAIAnalysis}
              disabled={analyzing}
              className={`w-full py-4 px-6 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all shadow-xl ${
                analyzing ? 'bg-slate-200 text-slate-400' : 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white hover:scale-[1.03] active:scale-95'
              }`}
            >
              {analyzing ? <ArrowPathIcon className="w-5 h-5 animate-spin" /> : <SparklesIcon className="w-5 h-5 text-yellow-300" />}
              {analyzing ? 'Processing...' : 'High-Precision Analysis'}
            </button>
          )}
        </div>

        <div ref={reportRef} id="analysis-report" className="lg:col-span-9 space-y-8 bg-slate-50">
          <div className="hidden print:block pb-6 border-b border-slate-200 mb-4">
            <h1 className="text-2xl font-bold text-slate-900">SpectraSync Precision Report</h1>
            <p className="text-slate-500 text-sm">Generated on {new Date().toLocaleDateString()}</p>
            <p className="text-slate-400 text-xs italic">Normalization: {normMethod.toUpperCase()} | Smoothing: {smoothingEnabled ? `Enabled (${smoothingWindow} pts)` : 'Disabled'}</p>
          </div>

          <section className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Spectral Curves</h2>
                <p className="text-slate-500 text-sm mt-1">Visualization using {normMethod === 'none' ? 'Raw Absorbance' : `${normMethod.toUpperCase()} normalization`}{smoothingEnabled ? ` with ${smoothingWindow}-point smoothing` : ''}</p>
              </div>
              <div className="flex gap-2">
                <div className="px-3 py-1 bg-blue-50 text-blue-700 rounded-lg text-[10px] font-bold uppercase tracking-wider">
                  {normMethod} mode
                </div>
                {smoothingEnabled && (
                   <div className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-[10px] font-bold uppercase tracking-wider">
                    Smoothed
                  </div>
                )}
              </div>
            </div>
            
            <div className="h-[450px] w-full">
              {samples.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={mergedChartData} margin={{ top: 10, right: 30, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="wavelength" type="number" domain={[rangeMin, rangeMax]} stroke="#94a3b8" fontSize={11}>
                      <Label value="Wavelength (nm)" offset={-10} position="insideBottom" fill="#94a3b8" fontSize={12} />
                    </XAxis>
                    <YAxis stroke="#94a3b8" fontSize={11}>
                      <Label 
                        value={normMethod === 'none' ? "Absorbance (AU)" : `Normalized Intensity (${normMethod})`} 
                        angle={-90} 
                        position="insideLeft" 
                        fill="#94a3b8" 
                        fontSize={12} 
                      />
                    </YAxis>
                    <Tooltip contentStyle={{ borderRadius: '16px', border: '1px solid #e2e8f0' }} />
                    <Legend verticalAlign="top" align="right" />
                    {samples.map(sample => (
                      <Line key={sample.id} type="monotone" dataKey={sample.name} stroke={sample.color} strokeWidth={1.5} dot={false} connectNulls animationDuration={800} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-100 rounded-3xl bg-slate-50/50">
                  <ChartBarIcon className="w-12 h-12 mb-4" />
                  <p className="font-semibold text-slate-400">Upload data to visualize spectral curves</p>
                </div>
              )}
            </div>
          </section>

          <section className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-8 border-b border-slate-100 bg-slate-50/30">
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <TableCellsIcon className="w-5 h-5 text-indigo-500" />
                High-Precision Similarity Matrix
              </h2>
              <p className="text-xs text-slate-500 mt-1">Metric precision increases with higher-order scaling ({normMethod === 'none' ? 'Area' : normMethod} normalization applied{smoothingEnabled ? ` with ${smoothingWindow}-pt smoothing` : ''}).</p>
            </div>
            {similarityMatrix.length === 0 ? (
              <div className="p-12 text-center text-slate-400 bg-slate-50/10">Compare 2+ samples within the selected wavelength range to populate results.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 font-bold uppercase text-[9px] tracking-widest border-b">
                      <th className="px-6 py-4 border-r border-slate-100">Pairs</th>
                      <th className="px-6 py-4 group cursor-help border-r border-slate-100" title="Pearson correlation coefficient (r) measures linear correlation between two spectra. 1.0 is perfect correlation.">
                        <div className="flex items-center gap-1">
                          Pearson (r)
                          <QuestionMarkCircleIcon className="w-3 h-3 text-slate-300 group-hover:text-blue-500 transition-colors" />
                        </div>
                      </th>
                      <th className="px-6 py-4 group cursor-help border-r border-slate-100" title="Measures the cosine of the angle between two spectral vectors. Shape comparison independent of intensity.">
                        <div className="flex items-center gap-1">
                          Cosine Sim.
                          <QuestionMarkCircleIcon className="w-3 h-3 text-slate-300 group-hover:text-blue-500 transition-colors" />
                        </div>
                      </th>
                      <th className="px-6 py-4 group cursor-help border-r border-slate-100" title="Root Mean Square Error calculated on normalized data. Direct distance measure between curve shapes.">
                        <div className="flex items-center gap-1">
                          Norm. RMSE
                          <QuestionMarkCircleIcon className="w-3 h-3 text-slate-300 group-hover:text-blue-500 transition-colors" />
                        </div>
                      </th>
                      <th className="px-6 py-4 group cursor-help border-r border-slate-100" title="Spectral Information Divergence (Probabilistic distance). Extremely sensitive to subtle discrepancy. SID is always calculated on area-normalized distributions for validity.">
                        <div className="flex items-center gap-1">
                          SID (bits)
                          <QuestionMarkCircleIcon className="w-3 h-3 text-slate-300 group-hover:text-blue-500 transition-colors" />
                        </div>
                      </th>
                      <th className="px-6 py-4">Identity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y text-sm">
                    {similarityMatrix.map((res, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-5 font-bold text-slate-700 border-r border-slate-100 bg-slate-50/10">{res.sampleA} / {res.sampleB}</td>
                        <td className={`px-6 py-5 font-mono text-xs border-r border-slate-100 ${getMetricColor(res.pearson, 'positive')}`}>
                          {res.pearson.toFixed(6)}
                        </td>
                        <td className={`px-6 py-5 font-mono text-xs border-r border-slate-100 ${getMetricColor(res.cosine, 'positive')}`}>
                          {res.cosine.toFixed(6)}
                        </td>
                        <td className={`px-6 py-5 font-mono text-xs border-r border-slate-100 ${getMetricColor(res.rmse, 'negative')}`}>
                          {res.rmse.toExponential(4)}
                        </td>
                        <td className={`px-6 py-5 font-mono text-xs border-r border-slate-100 ${getMetricColor(res.sid, 'negative')}`}>
                          {res.sid.toFixed(6)}
                        </td>
                        <td className="px-6 py-5">
                          {res.sid < 0.00001 ? (
                            <div className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-full text-[9px] font-black uppercase tracking-widest shadow-md border border-emerald-500">
                              <CheckBadgeIcon className="w-3.5 h-3.5" />
                              Chemically Identical
                            </div>
                          ) : (
                            <span className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-tighter block text-center ${res.sid < 0.001 ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-slate-100 text-slate-600 border border-slate-200'}`}>
                              {res.sid < 0.001 ? 'Very Similar' : 'Different'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {aiResult && (
            <section className="bg-white p-10 rounded-3xl shadow-xl border-t-4 border-indigo-600 relative break-inside-avoid overflow-hidden">
               <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none">
                <SparklesIcon className="w-48 h-48 text-indigo-900" />
              </div>
              <h2 className="text-xl font-black text-slate-900 mb-6 flex items-center gap-2">
                <SparklesIcon className="w-5 h-5 text-indigo-500" />
                Expert Interpretation
              </h2>
              <div className="bg-slate-50 p-8 rounded-2xl border border-slate-100 text-slate-700 text-sm leading-relaxed italic space-y-4 shadow-inner">
                {aiResult.split('\n').map((line, i) => (
                  <p key={i} className={line.trim() ? '' : 'h-2'}>
                    {line}
                  </p>
                ))}
              </div>
              <div className="mt-6 flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-t border-slate-100 pt-4">
                <InformationCircleIcon className="w-3.5 h-3.5" />
                Scientific assessment based on high-order spectral divergence metrics.
              </div>
            </section>
          )}
        </div>
      </main>

      <footer className="bg-white border-t border-slate-200 py-10 no-print">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6 text-slate-400">
          <div className="flex items-center gap-2">
            <BeakerIcon className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-widest">SpectraSync Precision Lab</span>
          </div>
          <p className="text-[11px] font-medium">&copy; {new Date().getFullYear()} Analytical Tool for High-Resolution Spectroscopic Comparison</p>
        </div>
      </footer>

      {loading && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <div className="bg-white p-10 rounded-3xl shadow-2xl flex flex-col items-center gap-6 text-center max-w-sm">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin" />
              <BeakerIcon className="w-6 h-6 text-blue-600 absolute inset-0 m-auto" />
            </div>
            <div>
              <p className="font-black text-slate-900 text-lg">Analyzing Data</p>
              <p className="text-slate-500 text-xs mt-1 leading-relaxed">Performing high-precision spectral interpolation and alignment...</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
