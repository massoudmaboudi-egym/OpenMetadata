#  Copyright 2021 Collate
#  Licensed under the Apache License, Version 2.0 (the "License");
#  you may not use this file except in compliance with the License.
#  You may obtain a copy of the License at
#  http://www.apache.org/licenses/LICENSE-2.0
#  Unless required by applicable law or agreed to in writing, software
#  distributed under the License is distributed on an "AS IS" BASIS,
#  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#  See the License for the specific language governing permissions and
#  limitations under the License.

"""
Read files as string from S3
"""
import traceback
from typing import List

from metadata.readers.file.base import Reader, ReadException
from metadata.utils.logger import ingestion_logger

logger = ingestion_logger()


class GCSReader(Reader):
    """GCS Reader
    Class to read from buckets with prefix as paths
    """

    def __init__(self, client):
        self.client = client

    def read(
        self, path: str, *, bucket_name: str = None, verbose: bool = True, **__
    ) -> bytes:
        try:
            return (
                self.client.get_bucket(bucket_name).get_blob(path).download_as_string()
            )
        except Exception as err:
            if verbose:
                logger.debug(traceback.format_exc())
            raise ReadException(f"Error fetching file [{path}] from repo: {err}")

    def _get_tree(self) -> List[str]:
        """
        We are not implementing this yet. This should
        only be needed for now for the Datalake where we don't need
        to traverse any directories.
        """
        raise NotImplementedError("Not implemented")
