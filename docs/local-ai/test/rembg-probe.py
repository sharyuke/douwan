import sys, time
t0 = time.time()
import rembg
t1 = time.time()
print("rembg version:", getattr(rembg, "__version__", "?"), flush=True)
print("rembg import seconds:", round(t1 - t0, 2), flush=True)
import onnxruntime as ort
t2 = time.time()
print("onnxruntime:", ort.__version__, flush=True)
print("providers:", ort.get_available_providers(), flush=True)
print("onnxruntime import seconds:", round(t2 - t1, 2), flush=True)
print("python:", sys.version, flush=True)