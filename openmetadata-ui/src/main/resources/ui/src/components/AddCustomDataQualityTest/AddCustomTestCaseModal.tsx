/*
 *  Copyright 2022 Collate.
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *  http://www.apache.org/licenses/LICENSE-2.0
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

import {
  Col,
  Form,
  FormProps,
  Input,
  InputNumber,
  Row,
  Select,
  Typography,
} from 'antd';
import Modal from 'antd/lib/modal/Modal';
import { AxiosError } from 'axios';
import { HTTP_STATUS_CODE } from 'constants/auth.constants';
import { SUPPORTED_PARTITION_TYPE_FOR_DATE_TIME } from 'constants/profiler.constant';
import { ENTITY_NAME_REGEX } from 'constants/regex.constants';
import cryptoRandomString from 'crypto-random-string-with-promisify-polyfill';
import { OwnerType } from 'enums/user.enum';
import { CreateTestCase } from 'generated/api/tests/createTestCase';
import { DataType, Table } from 'generated/entity/data/table';
import { TestCaseParameterValue, TestSuite } from 'generated/tests/testCase';
import { isUndefined, snakeCase, sortBy, split } from 'lodash';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getTableDetailsByFQN } from 'rest/tableAPI';
import { createExecutableTestSuite, createTestCase } from 'rest/testAPI';
import {
  getCurrentUserId,
  replaceAllSpacialCharWith_,
} from 'utils/CommonUtils';
import { generateEntityLink } from 'utils/TableUtils';
import { CSMode } from '../../enums/codemirror.enum';
import { showErrorToast, showSuccessToast } from '../../utils/ToastUtils';
import Loader from '../Loader/Loader';
import SchemaEditor from '../schema-editor/SchemaEditor';
import { AddCustomTestCaseModalProps } from './AddCustomDataQualityTest.interface';

interface CustomColumn {
  value: string;
  label: string;
  dataType: string;
}

const sqlTemplate = `
    WITH Total AS (
      SELECT
        COUNT(sourceTable."$sourceTableColumnCount") AS TotalNumber
      FROM
        $sourceTableFQN AS sourceTable
      LEFT JOIN
        $targetTableFQN AS targetTable
      ON
        sourceTable."$sourceTableMappingKey" = targetTable."$targetTableMappingKey"
      WHERE
        sourceTable."$sourceTableColumnCount" IS NOT NULL
        AND sourceTable."$sourceTableMappingKey" IS NOT NULL
        AND sourceTable."$sourceTableUpdateColumn" >= CURRENT_DATE() - INTERVAL '$interval'
    ),
    Condition AS (
      SELECT
        COUNT(sourceTable."$sourceTableColumnCount") AS ConditionalCount
      FROM
        $sourceTableFQN AS sourceTable
      LEFT JOIN
        $targetTableFQN AS targetTable
      ON
        sourceTable."$sourceTableMappingKey" = targetTable."$targetTableMappingKey"
      WHERE
        sourceTable."$sourceTableColumnCount" IS NOT NULL
        AND sourceTable."$sourceTableMappingKey" IS NOT NULL
        AND sourceTable."$sourceTableColumnCondition" != targetTable."$targetTableColumnCondition"
        AND sourceTable."$sourceTableUpdateColumn" >= CURRENT_DATE() - INTERVAL '$interval'
    ),
    Percentage AS (
      SELECT 
        ROUND(Condition.ConditionalCount * 100.0 / Total.TotalNumber, 2) AS Percentage
      FROM Total, Condition
    )
    SELECT 1 AS Result
    FROM Percentage
    WHERE Percentage > $threshold;
  `;

const AddCustomTestCaseModal: React.FC<AddCustomTestCaseModalProps> = ({
  visible,
  // testCase,
  edgeData,
  onCancel,
  onUpdate,
}) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  // const [selectedDefinition, setSelectedDefinition] =
  //   useState<TestDefinition>();
  const [isLoading, setIsLoading] = useState(true);
  // const [isUpdate, _] = useState(edgeData === undefined);
  const [isLoadingOnSave, setIsLoadingOnSave] = useState(false);
  const [testSuiteData, setTestSuiteData] = useState<TestSuite>();
  // const [testcaseName, setTestcaseName] = useState('');
  const [sourceTable, setSourceTable] = useState<Table>();
  const [targetTable, setTargetTable] = useState<Table>();

  const [sourceTableColumns, setSourceTableColumns] =
    useState<CustomColumn[]>();
  const [targetTableColumns, setTargetTableColumns] =
    useState<CustomColumn[]>();

  const [timeFrameRequired, setTimeFrameRequired] = useState(false);

  const owner = useMemo(
    () => ({
      id: getCurrentUserId(),
      type: OwnerType.USER,
    }),
    [getCurrentUserId]
  );

  useEffect(() => {
    onUpdate?.name;
  }, []);

  useEffect(() => {
    setIsLoading(true);
    try {
      fetchSourceTable();
      fetchTargetTable();
    } catch (error) {
      showErrorToast(error as AxiosError);
    }
    setIsLoading(false);
  }, [edgeData]);

  useEffect(() => {
    if (sourceTable?.columns) {
      const res = extractTableFQN(sourceTable);
      res &&
        form.setFieldsValue({
          ...form.getFieldsValue(),
          ['sourceTableFQN']: res,
        });
      const columns = extractColumnFromTable(sourceTable);
      const sortedColumns = sortBy(columns, (o) => o.value.toLowerCase());
      setSourceTableColumns(sortedColumns);
    }
  }, [sourceTable]);

  useEffect(() => {
    if (targetTable?.columns) {
      const res = extractTableFQN(targetTable);
      res &&
        form.setFieldsValue({
          ...form.getFieldsValue(),
          ['targetTableFQN']: res,
        });

      const columns = extractColumnFromTable(targetTable);
      const sortedColumns = sortBy(columns, (o) => o.value.toLowerCase());
      setTargetTableColumns(sortedColumns);
    }
  }, [targetTable]);

  const extractTableFQN = (table: Table | undefined) => {
    if (table) {
      const nameWithoutSource: string[] = table.fullyQualifiedName
        ?.split('.')
        .slice(1, -1) as string[];
      nameWithoutSource.push(`"${table.name}"`);

      return nameWithoutSource.join('.');
    }

    return;
  };

  const createTestCaseObj = (value: {
    testName: string;
    params: Record<string, string | { [key: string]: string }[]>;
    testTypeId: string;
  }): CreateTestCase => {
    // console.log("value", value);

    const parameterValues = Object.entries(value.params || {}).map(
      ([key, value]) => ({
        name: key,
        value: value,
      })
    );

    const name =
      value.testName?.trim() ||
      `${replaceAllSpacialCharWith_(sourceTable?.name as string)}_${snakeCase(
        value.testTypeId
      )}_${cryptoRandomString({
        length: 4,
        type: 'alphanumeric',
      })}`;

    return {
      name,
      displayName: name,
      entityLink: generateEntityLink(
        sourceTable?.fullyQualifiedName as string,
        false
      ),
      parameterValues: parameterValues as TestCaseParameterValue[],
      testDefinition: value.testTypeId,
      // description: markdownRef.current?.getEditorContent(),
      testSuite: '',
    };
  };

  const createTestSuite = async () => {
    const testSuite = {
      name: `${sourceTable?.fullyQualifiedName}.testSuite`,
      executableEntityReference: sourceTable?.fullyQualifiedName,
      owner,
    };
    const response = await createExecutableTestSuite(testSuite);
    setTestSuiteData(response);

    return response;
  };

  const handleFormSubmit: FormProps['onFinish'] = async (value) => {
    // console.log('Form Data:', value)

    const standardValues: {
      testName: string;
      params: Record<string, string | { [key: string]: string }[]>;
      testTypeId: string;
    } = {
      testName: value.testName,
      testTypeId: 'tableCustomSQLQuery',
      params: {
        sqlExpression: value.sql,
        strategy: 'ROWS',
      },
    };

    const testCasePayload = createTestCaseObj(standardValues);
    // console.log('testCasePayload', testCasePayload);

    try {
      setIsLoadingOnSave(true);
      const testSuite = isUndefined(testSuiteData)
        ? await createTestSuite()
        : sourceTable?.testSuite;

      const createTestCasePayload: CreateTestCase = {
        ...testCasePayload,
        owner,
        testSuite: testSuite?.fullyQualifiedName ?? '',
      };

      await createTestCase(createTestCasePayload);

      showSuccessToast(
        t('server.update-entity-success', { entity: t('label.test-case') })
      );
    } catch (error) {
      if (
        (error as AxiosError).response?.status === HTTP_STATUS_CODE.CONFLICT
      ) {
        showErrorToast(
          t('server.entity-already-exist', {
            entity: t('label.test-case'),
            entityPlural: t('label.test-case-lowercase-plural'),
            name: testCasePayload.name,
          })
        );
      } else {
        showErrorToast(
          error as AxiosError,
          t('server.create-entity-error', {
            entity: t('label.test-case-lowercase'),
          })
        );
      }
    } finally {
      setIsLoadingOnSave(false);
    }
  };

  const fetchTableData = async (entityFQN: string, entityType: string) => {
    setIsLoading(true);
    try {
      const tableDetails = await getTableDetailsByFQN(entityFQN, [
        'columns',
        'testSuite',
      ]);
      if (entityType === 'source') {
        setSourceTable(tableDetails);
        setTestSuiteData(tableDetails?.testSuite);
      } else if (entityType === 'target') {
        setTargetTable(tableDetails);
      }
    } catch (error) {
      showErrorToast(error as AxiosError);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSourceTable = async () => {
    await fetchTableData(
      split(edgeData?.sourceData?.link, '/').pop() as string,
      'source'
    );
  };

  const fetchTargetTable = async () => {
    await fetchTableData(
      split(edgeData?.targetData?.link, '/').pop() as string,
      'target'
    );
  };

  const extractColumnFromTable = (table: Table) => {
    return table.columns.reduce((result, column) => {
      return [
        ...result,
        {
          value: column.name,
          label: column.name,
          dataType: column.dataType,
        },
      ];
    }, [] as CustomColumn[]);
  };

  const filterDateTimeColumns = (
    columns: CustomColumn[]
  ): CustomColumn[] | undefined => {
    try {
      return columns.filter((col) =>
        SUPPORTED_PARTITION_TYPE_FOR_DATE_TIME.includes(
          col.dataType as DataType
        )
      );
    } catch (error) {
      return;
    }
  };

  const handleSourceTableInternalColumnChange = () => {
    setTimeFrameRequired(true);
  };

  const handleFormValueChange: FormProps['onValuesChange'] = (
    changedValue: { [key: string]: string },
    values: { [key: string]: string }
  ) => {
    if (Object.keys(changedValue)[0] !== 'sql') {
      setIsLoading(true);
      let tempSql = sqlTemplate;

      for (const key of Object.keys(values)) {
        if (values[key] !== undefined) {
          tempSql = tempSql.replaceAll(`$${key}`, values[key] as any);
        }
      }

      // remove unnecessary templates
      if (!timeFrameRequired) {
        tempSql = tempSql.replaceAll(
          'AND sourceTable."$sourceTableUpdateColumn" >= CURRENT_DATE() - INTERVAL \'$interval\'',
          ''
        );
      }

      form.setFieldValue('sql', tempSql);

      setIsLoading(false);
    }
  };

  const columnsOptionEnhancer = (columns: CustomColumn[] | undefined) => {
    if (columns) {
      return columns.map((col) => (
        <Select.Option key={col.value} value={col.value}>
          {col.value}
          <span style={{ float: 'right' }}>
            <Typography.Text disabled>{col.dataType}</Typography.Text>
          </span>
        </Select.Option>
      ));
    }

    return columns;
  };

  return (
    <Modal
      centered
      destroyOnClose
      afterClose={() => {
        form.resetFields();
        onCancel();
      }}
      cancelText={t('label.cancel')}
      closable={false}
      confirmLoading={isLoadingOnSave}
      maskClosable={false}
      okText={t('label.submit')}
      open={visible}
      title={`Add Column Test Case for ${edgeData.sourceData?.value} and ${edgeData.targetData?.value} `}
      width={960}
      onCancel={onCancel}
      onOk={() => form.submit()}>
      {isLoading ? (
        <Loader />
      ) : (
        <Form
          data-testid="edit-test-form"
          form={form}
          layout="vertical"
          name="tableTestForm"
          onFinish={handleFormSubmit}
          onValuesChange={handleFormValueChange}>
          <Row gutter={[16, 16]}>
            <Col span={12}>
              <Form.Item
                required
                label={t('label.table')}
                name="sourceTableFQN">
                <Input disabled placeholder="Source Table" />
              </Form.Item>
              <Form.Item
                required
                label="Source Column"
                name="sourceTableColumnCondition"
                rules={[
                  {
                    required: true,
                    message: `${t('label.field-required', {
                      field: 'Source Column',
                    })}`,
                  },
                ]}>
                <Select
                  showSearch
                  // options={ }
                  // optionLabelProp='value'
                  placeholder={t('message.select-column-name')}>
                  {columnsOptionEnhancer(sourceTableColumns)}
                </Select>
              </Form.Item>
              <Form.Item
                required
                label="Source Mapping Column"
                name="sourceTableMappingKey"
                rules={[
                  {
                    required: true,
                    message: `${t('label.field-required', {
                      field: 'Source Mapping Column',
                    })}`,
                  },
                ]}>
                <Select
                  showSearch
                  // options={sourceTableColumns}
                  placeholder={t('message.select-column-name')}>
                  {columnsOptionEnhancer(sourceTableColumns)}
                </Select>
              </Form.Item>
              <Form.Item
                required
                label="Source Column to Count"
                name="sourceTableColumnCount"
                rules={[
                  {
                    required: true,
                    message: `${t('label.field-required', {
                      field: 'Source Column to Count',
                    })}`,
                  },
                ]}>
                <Select
                  showSearch
                  // options={sourceTableColumns}
                  placeholder={t('message.select-column-name')}>
                  {columnsOptionEnhancer(sourceTableColumns)}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                required
                label={`Target ${t('label.table')}`}
                name="targetTableFQN">
                <Input disabled placeholder={edgeData?.targetData?.value} />
              </Form.Item>
              <Form.Item
                required
                label="Target Column"
                name="targetTableColumnCondition"
                rules={[
                  {
                    required: true,
                    message: `${t('label.field-required', {
                      field: 'Target Column',
                    })}`,
                  },
                ]}>
                <Select
                  showSearch
                  // options={targetTableColumns}
                  placeholder={t('message.select-column-name')}>
                  {columnsOptionEnhancer(targetTableColumns)}
                </Select>
              </Form.Item>
              <Form.Item
                required
                label="Target Mapping Column"
                name="targetTableMappingKey"
                rules={[
                  {
                    required: true,
                    message: `${t('label.field-required', {
                      field: 'Target Mapping Column',
                    })}`,
                  },
                ]}>
                <Select
                  showSearch
                  // options={targetTableColumns}
                  placeholder={t('message.select-column-name')}>
                  {columnsOptionEnhancer(targetTableColumns)}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={[16, 16]}>
            <Col span={12}>
              <Form.Item
                // required
                label={t('label.name')}
                name="testName"
                rules={[
                  {
                    pattern: ENTITY_NAME_REGEX,
                    message: t('message.entity-name-validation'),
                  },
                  {
                    required: true,
                    message: `${t('label.field-required', {
                      field: t('label.name'),
                    })}`,
                  },
                  // {
                  //   validator: (_, value) => {
                  //     if (testCases.some((test) => test.name === value)) {
                  //       return Promise.reject(
                  //         t('message.entity-already-exists', {
                  //           entity: t('label.name'),
                  //         })
                  //       );
                  //     }

                  //     return Promise.resolve();
                  //   },
                  // },
                ]}>
                <Input placeholder={t('message.enter-test-case-name')} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                required
                label="Threshold"
                name="threshold"
                rules={[
                  {
                    required: true,
                    message: `${t('label.field-required', {
                      field: 'Threshold',
                    })}`,
                  },
                ]}>
                <InputNumber
                  className="w-full"
                  max={100}
                  min={1}
                  placeholder="Please enter a threshold"
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={[16, 16]}>
            <Col span={12}>
              <Form.Item
                label="Source Interval Column"
                name="sourceTableUpdateColumn"
                required={timeFrameRequired}>
                <Select
                  showSearch
                  // options={filterDateTimeColumns(sourceTableColumns as CustomColumn[])}
                  placeholder={t('message.select-column-name')}
                  onChange={handleSourceTableInternalColumnChange}>
                  {columnsOptionEnhancer(
                    filterDateTimeColumns(sourceTableColumns as CustomColumn[])
                  )}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="Timeframe"
                name="interval"
                required={timeFrameRequired}
                rules={
                  timeFrameRequired
                    ? [
                        {
                          required: timeFrameRequired,
                          message: `${t('label.field-required', {
                            field: 'Timeframe',
                          })}`,
                        },
                      ]
                    : []
                }>
                <Select
                  disabled={!timeFrameRequired}
                  options={[
                    {
                      value: '1 months',
                      label: 'Last 1 months',
                    },
                    {
                      value: '3 months',
                      label: 'Last 3 months',
                    },
                    {
                      value: '6 months',
                      label: 'Last 6 months',
                    },
                  ]}
                  placeholder="Select the timeframe"
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            required
            label="SQL"
            name="sql"
            // initialValue={sqlTemplate}
          >
            <SchemaEditor
              className="custom-query-editor query-editor-h-400"
              mode={{ name: CSMode.SQL }}
              options={{
                readOnly: false,
              }}
            />
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
};

export default AddCustomTestCaseModal;
