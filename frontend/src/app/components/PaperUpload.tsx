import { useState } from "react";
import { useNavigate } from "react-router";
import { Upload, FileCheck, X } from "lucide-react";
import { employeeRoutes } from "../lib/employeeRoutes";

export function PaperUpload() {
  const navigate = useNavigate();
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file.name);
    }
  };

  const handleSubmit = () => {
    navigate(employeeRoutes.thankYou);
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-white rounded-3xl shadow-xl p-6 md:p-10 border border-brand-100">
        {/* Header */}
        <div className="text-center mb-8">
          <h2 className="text-3xl md:text-4xl text-gray-800 mb-3">
            Upload Paper Feedback
          </h2>
          <p className="text-lg md:text-xl text-gray-600">
            Scan and upload your completed feedback form
          </p>
        </div>

        {/* Upload Area */}
        <div className="mb-8">
          <label
            htmlFor="file-upload"
            className={`border-4 border-dashed rounded-3xl p-12 md:p-16 flex flex-col items-center gap-6 cursor-pointer transition-all duration-200 ${
              uploadedFile
                ? 'border-green-400 bg-green-50'
                : 'border-brand-300 bg-brand-50 hover:bg-brand-100 hover:border-brand-400'
            }`}
          >
            {uploadedFile ? (
              <>
                <FileCheck size={80} className="text-green-600" strokeWidth={2} />
                <div className="text-center">
                  <p className="text-xl md:text-2xl font-semibold text-green-600 mb-2">
                    File Uploaded
                  </p>
                  <p className="text-lg text-gray-700">{uploadedFile}</p>
                </div>
              </>
            ) : (
              <>
                <Upload size={80} className="text-brand-600" strokeWidth={2} />
                <div className="text-center">
                  <p className="text-xl md:text-2xl font-semibold text-gray-800 mb-2">
                    Click to upload or drag and drop
                  </p>
                  <p className="text-base md:text-lg text-gray-600">
                    PDF, JPG, or PNG (Max 10MB)
                  </p>
                </div>
              </>
            )}
          </label>
          <input
            id="file-upload"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        {/* Preview Area */}
        {uploadedFile && (
          <div className="bg-gray-50 rounded-2xl p-6 mb-8 border border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <FileCheck size={32} className="text-green-600" />
                <div>
                  <p className="font-semibold text-gray-800">Preview</p>
                  <p className="text-sm text-gray-600">{uploadedFile}</p>
                </div>
              </div>
              <button
                onClick={() => setUploadedFile(null)}
                className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <X size={24} className="text-gray-600" />
              </button>
            </div>
          </div>
        )}

        {/* Submit Button */}
        <button
          onClick={handleSubmit}
          disabled={!uploadedFile}
          className={`w-full text-2xl md:text-3xl py-6 md:py-8 rounded-2xl font-bold shadow-lg transition-all duration-200 mb-6 ${
            uploadedFile
              ? 'bg-[#2FBF71] text-white hover:bg-[#28a962] hover:shadow-xl hover:scale-[1.02]'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          Submit Feedback
        </button>

        {/* Back Link */}
        <div className="text-center">
          <button
            onClick={() => navigate(employeeRoutes.home)}
            className="text-gray-500 hover:text-primary text-lg transition-colors"
          >
            ← Choose Different Method
          </button>
        </div>
      </div>
    </div>
  );
}
