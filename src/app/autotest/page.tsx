'use client';
import '../../scenarios/darylweb_scenarios';
import { AutoTestProvider, AutoTestRunner } from 'hazo_ui/test-harness';
export default function AutotestPage() {
  return (<AutoTestProvider pkg="darylweb"><AutoTestRunner /></AutoTestProvider>);
}
