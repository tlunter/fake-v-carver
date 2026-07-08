import React, { useRef, useState } from 'react'

interface DropZoneProps {
  onFile: (text: string, fileName: string) => void
}

export function DropZone({ onFile }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const processFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.svg')) {
      setError('Please upload an SVG file.')
      return
    }
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      if (!text.includes('<svg') && !text.includes('<SVG')) {
        setError('File does not appear to be a valid SVG.')
        return
      }
      setError(null)
      onFile(text, file.name)
    }
    reader.readAsText(file)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={[
          'cursor-pointer border-2 border-dashed rounded-2xl',
          'flex flex-col items-center justify-center gap-4',
          'w-full max-w-lg aspect-video transition-colors',
          dragging
            ? 'border-blue-400 bg-blue-950/30'
            : 'border-neutral-600 hover:border-neutral-400 bg-neutral-900/50',
        ].join(' ')}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-12 h-12 text-neutral-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
          />
        </svg>
        <div className="text-center">
          <p className="text-neutral-200 font-medium">
            Drop an SVG file here
          </p>
          <p className="text-neutral-500 text-sm mt-1">
            or click to browse
          </p>
        </div>
        {error && (
          <p className="text-red-400 text-sm">{error}</p>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".svg,image/svg+xml"
          className="hidden"
          onChange={onInputChange}
        />
      </div>
    </div>
  )
}
