# Auto-loaded by Python when this directory is on PYTHONPATH.
#
# The OCI-hosted QA databases (qabis1 etc.) enforce Oracle Native Network
# Encryption, which python-oracledb only supports in thick mode. Every DB
# helper in tests/_helpers shells out to `python3 -c "import oracledb ..."`,
# so instead of patching each call site we switch the driver to thick mode
# here, once per interpreter, when ORACLE_CLIENT_LIB points at an Instant
# Client directory. Without the env var this is a no-op (qa4/qa5 stay thin).
import os

_lib = os.environ.get('ORACLE_CLIENT_LIB')
if _lib:
    try:
        import oracledb

        oracledb.init_oracle_client(lib_dir=_lib)
    except ImportError:
        pass
