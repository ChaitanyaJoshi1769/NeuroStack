'use client';

import React from 'react';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center">
          <h1 className="text-5xl font-bold text-white mb-4">
            NeuroStack
          </h1>
          <p className="text-xl text-slate-300 mb-8">
            The AI-native data + intelligence operating system
          </p>
          <div className="space-y-4">
            <p className="text-slate-400">
              Unified structured + vector data + semantic intelligence
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-12">
              <div className="p-6 bg-slate-700 rounded-lg">
                <h3 className="text-lg font-semibold text-white mb-2">
                  Hybrid Query Engine
                </h3>
                <p className="text-slate-300 text-sm">
                  SQL + Vector queries unified
                </p>
              </div>
              <div className="p-6 bg-slate-700 rounded-lg">
                <h3 className="text-lg font-semibold text-white mb-2">
                  Semantic Intelligence
                </h3>
                <p className="text-slate-300 text-sm">
                  Business context embedded in data
                </p>
              </div>
              <div className="p-6 bg-slate-700 rounded-lg">
                <h3 className="text-lg font-semibold text-white mb-2">
                  AI Agents
                </h3>
                <p className="text-slate-300 text-sm">
                  Autonomous reasoning & action
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
