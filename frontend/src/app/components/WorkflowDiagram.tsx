import { ArrowRight, Database, Brain, GitBranch, MessageSquare, Star, BarChart3, AlertCircle, CheckCircle, Send, Phone } from "lucide-react";

export function WorkflowDiagram() {
  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="text-center mb-10">
        <h2 className="text-3xl md:text-4xl font-bold text-gray-800 mb-3">
          System Flow Visualization
        </h2>
        <p className="text-lg text-gray-600">
          Automated feedback processing pipeline
        </p>
      </div>

      {/* Main Workflow - Horizontal */}
      <div className="bg-white rounded-3xl p-8 md:p-12 shadow-xl mb-10 border-2 border-primary">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Step 1: Feedback Input */}
          <div className="flex flex-col items-center text-center flex-1">
            <div className="w-20 h-20 md:w-24 md:h-24 bg-primary rounded-2xl flex items-center justify-center mb-3 shadow-lg">
              <MessageSquare size={40} className="text-white" strokeWidth={2.5} />
            </div>
            <h3 className="font-bold text-gray-800 mb-1 text-lg">Feedback Input</h3>
            <p className="text-sm text-gray-600">Multi-channel</p>
          </div>

          <ArrowRight size={36} className="text-primary hidden md:block" strokeWidth={3} />

          {/* Step 2: Data Storage */}
          <div className="flex flex-col items-center text-center flex-1">
            <div className="w-20 h-20 md:w-24 md:h-24 bg-[#2FBF71] rounded-2xl flex items-center justify-center mb-3 shadow-lg">
              <Database size={40} className="text-white" strokeWidth={2.5} />
            </div>
            <h3 className="font-bold text-gray-800 mb-1 text-lg">Data Storage</h3>
            <p className="text-sm text-gray-600">Secure database</p>
          </div>

          <ArrowRight size={36} className="text-primary hidden md:block" strokeWidth={3} />

          {/* Step 3: AI Analysis */}
          <div className="flex flex-col items-center text-center flex-1">
            <div className="w-20 h-20 md:w-24 md:h-24 bg-[#8B5CF6] rounded-2xl flex items-center justify-center mb-3 shadow-lg">
              <Brain size={40} className="text-white" strokeWidth={2.5} />
            </div>
            <h3 className="font-bold text-gray-800 mb-1 text-lg">AI Analysis</h3>
            <p className="text-sm text-gray-600">Sentiment detection</p>
          </div>

          <ArrowRight size={36} className="text-primary hidden md:block" strokeWidth={3} />

          {/* Step 4: Decision Engine */}
          <div className="flex flex-col items-center text-center flex-1">
            <div className="w-20 h-20 md:w-24 md:h-24 bg-[#F4A261] rounded-2xl flex items-center justify-center mb-3 shadow-lg">
              <GitBranch size={40} className="text-white" strokeWidth={2.5} />
            </div>
            <h3 className="font-bold text-gray-800 mb-1 text-lg">Decision Engine</h3>
            <p className="text-sm text-gray-600">Smart routing</p>
          </div>

          <ArrowRight size={36} className="text-primary hidden md:block" strokeWidth={3} />

          {/* Step 5: Outcome */}
          <div className="flex flex-col items-center text-center flex-1">
            <div className="w-20 h-20 md:w-24 md:h-24 bg-[#E5533D] rounded-2xl flex items-center justify-center mb-3 shadow-lg">
              <CheckCircle size={40} className="text-white" strokeWidth={2.5} />
            </div>
            <h3 className="font-bold text-gray-800 mb-1 text-lg">Outcome</h3>
            <p className="text-sm text-gray-600">Automated action</p>
          </div>
        </div>
      </div>

      {/* Outcome Branches - Color Coded */}
      <div className="mb-10">
        <h3 className="text-2xl font-bold text-gray-800 mb-6 text-center">
          Automated Outcomes Based on Sentiment
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* Positive */}
          <div className="bg-white rounded-2xl p-6 shadow-lg border-4 border-[#2FBF71]">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-14 h-14 bg-[#2FBF71] rounded-xl flex items-center justify-center shadow-md">
                <Star size={28} className="text-white" fill="white" />
              </div>
              <div>
                <h4 className="font-bold text-gray-800 text-lg">Positive</h4>
                <p className="text-xs text-gray-600">😍 😃</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <Send size={16} className="text-[#2FBF71] mt-1 flex-shrink-0" />
                <p className="text-sm font-semibold text-gray-700">Thank you message sent</p>
              </div>
              <div className="flex items-start gap-2">
                <Star size={16} className="text-[#2FBF71] mt-1 flex-shrink-0" />
                <p className="text-sm font-semibold text-gray-700">Review prompt (Google)</p>
              </div>
              <div className="flex items-start gap-2">
                <BarChart3 size={16} className="text-[#2FBF71] mt-1 flex-shrink-0" />
                <p className="text-sm font-semibold text-gray-700">Added to dashboard</p>
              </div>
            </div>
          </div>

          {/* Neutral */}
          <div className="bg-white rounded-2xl p-6 shadow-lg border-4 border-[#F4A261]">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-14 h-14 bg-[#F4A261] rounded-xl flex items-center justify-center shadow-md">
                <BarChart3 size={28} className="text-white" />
              </div>
              <div>
                <h4 className="font-bold text-gray-800 text-lg">Neutral</h4>
                <p className="text-xs text-gray-600">😐</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <Database size={16} className="text-[#F4A261] mt-1 flex-shrink-0" />
                <p className="text-sm font-semibold text-gray-700">Logged to dashboard</p>
              </div>
              <div className="flex items-start gap-2">
                <Brain size={16} className="text-[#F4A261] mt-1 flex-shrink-0" />
                <p className="text-sm font-semibold text-gray-700">Pattern analysis</p>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle size={16} className="text-[#F4A261] mt-1 flex-shrink-0" />
                <p className="text-sm font-semibold text-gray-700">No immediate action</p>
              </div>
            </div>
          </div>

          {/* Negative */}
          <div className="bg-white rounded-2xl p-6 shadow-lg border-4 border-[#E5533D]">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-14 h-14 bg-[#E5533D] rounded-xl flex items-center justify-center shadow-md">
                <AlertCircle size={28} className="text-white" />
              </div>
              <div>
                <h4 className="font-bold text-gray-800 text-lg">Negative</h4>
                <p className="text-xs text-gray-600">😟</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <MessageSquare size={16} className="text-[#E5533D] mt-1 flex-shrink-0" />
                <p className="text-sm font-semibold text-gray-700">Complaint ticket created</p>
              </div>
              <div className="flex items-start gap-2">
                <Send size={16} className="text-[#E5533D] mt-1 flex-shrink-0" />
                <p className="text-sm font-semibold text-gray-700">Assigned to team</p>
              </div>
              <div className="flex items-start gap-2">
                <Phone size={16} className="text-[#E5533D] mt-1 flex-shrink-0" />
                <p className="text-sm font-semibold text-gray-700">Follow-up in 24 hours</p>
              </div>
            </div>
          </div>

          {/* Critical */}
          <div className="bg-white rounded-2xl p-6 shadow-lg border-4 border-[#E5533D] relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-[#E5533D] text-white text-xs font-bold px-3 py-1 rounded-bl-lg">
              URGENT
            </div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-14 h-14 bg-[#E5533D] rounded-xl flex items-center justify-center shadow-md animate-pulse">
                <AlertCircle size={28} className="text-white" />
              </div>
              <div>
                <h4 className="font-bold text-gray-800 text-lg">Critical</h4>
                <p className="text-xs text-gray-600">😡</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <AlertCircle size={16} className="text-[#E5533D] mt-1 flex-shrink-0" />
                <p className="text-sm font-semibold text-gray-700">Immediate alert sent</p>
              </div>
              <div className="flex items-start gap-2">
                <Phone size={16} className="text-[#E5533D] mt-1 flex-shrink-0" />
                <p className="text-sm font-semibold text-gray-700">Manager notified</p>
              </div>
              <div className="flex items-start gap-2">
                <Send size={16} className="text-[#E5533D] mt-1 flex-shrink-0" />
                <p className="text-sm font-semibold text-gray-700">Priority escalation</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* AI Features Section */}
      <div className="bg-gradient-to-r from-[#8B5CF6] to-primary rounded-3xl p-1 shadow-xl">
        <div className="bg-white rounded-[22px] p-8">
          <h3 className="text-2xl font-bold text-gray-800 mb-6 text-center flex items-center justify-center gap-3">
            <Brain size={32} className="text-[#8B5CF6]" />
            AI-Powered Intelligence
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-[#FFFBF5] rounded-xl p-6 border-l-4 border-[#8B5CF6]">
              <div className="flex items-start gap-3 mb-3">
                <Brain size={28} className="text-[#8B5CF6] flex-shrink-0" />
                <div>
                  <h4 className="font-bold text-gray-800 mb-2 text-lg">Sentiment Analysis</h4>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Automatically detects emotion and urgency level from employee feedback using natural language processing
                  </p>
                </div>
              </div>
            </div>
            <div className="bg-[#FFFBF5] rounded-xl p-6 border-l-4 border-primary">
              <div className="flex items-start gap-3 mb-3">
                <MessageSquare size={28} className="text-primary flex-shrink-0" />
                <div>
                  <h4 className="font-bold text-gray-800 mb-2 text-lg">Keyword Extraction</h4>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Identifies key issues, topics, and complaint categories mentioned in employee feedback text
                  </p>
                </div>
              </div>
            </div>
            <div className="bg-[#FFFBF5] rounded-xl p-6 border-l-4 border-[#2FBF71]">
              <div className="flex items-start gap-3 mb-3">
                <GitBranch size={28} className="text-[#2FBF71] flex-shrink-0" />
                <div>
                  <h4 className="font-bold text-gray-800 mb-2 text-lg">Smart Routing</h4>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Routes feedback to appropriate department and assigns priority level automatically
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Speed Metric */}
      <div className="mt-8 text-center">
        <div className="inline-flex items-center gap-2 bg-white px-6 py-3 rounded-full shadow-md border-2 border-[#2FBF71]">
          <CheckCircle size={20} className="text-[#2FBF71]" />
          <p className="text-sm font-bold text-gray-700">
            Complete process: Feedback → Action in under 5 seconds
          </p>
        </div>
      </div>
    </div>
  );
}
